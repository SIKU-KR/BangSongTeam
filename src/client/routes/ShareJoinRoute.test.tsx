import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useParams, useSearchParams } from "next/navigation";
import { MemoryRouter, Route, Routes } from "../test/router";
import type { PresentationDocument } from "#shared";
import { signInAsTestUser } from "../test/sessionFixture";
import { installFakeApi, type FakeApi, type FakeRoute } from "../test/fakeApi";
import { withQueryClient } from "../test/queryClientFixture";
import { ConsentGate } from "../features/auth/ConsentGate";
import {
  __loadDocumentsForTests,
  getPresentationById,
  resetPresentationStore,
} from "../features/presentation/presentationStore";
import { rememberJoinedShare } from "../features/sharing/joinedShares";
import { ShareJoinRoute } from "./ShareJoinRoute";
import { API_ERRORS } from "#shared";
import { COMMON_COPY, ERROR_COPY } from "#copy/common";
import { SHARE_LINK_COPY } from "#copy/shareLink";
import { SEED_PRESENTATIONS, SEED_USER_ID } from "../test/presentationFixture";

const OWNER = "0000000000000000owner";

function EditorProbe(): React.JSX.Element {
  const { presentationId } = useParams<{ presentationId?: string }>();
  const search = useSearchParams().toString();
  return (
    <p data-testid="editor-probe" data-search={search}>
      {presentationId}
    </p>
  );
}

function renderAt(path: string) {
  return render(
    withQueryClient(
      <MemoryRouter initialEntries={[path]}>
        <ConsentGate />
        <Routes>
          <Route path="/s/:token" element={<ShareJoinRoute />} />
          <Route path="/editor/:presentationId" element={<EditorProbe />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

let agreedAt: string | null = null;

function withConsent(
  routes: Record<string, FakeRoute>,
): Record<string, FakeRoute> {
  return {
    "GET /api/consent": () => ({ body: { agreedAt } }),
    "POST /api/consent": () => {
      agreedAt = "2026-09-27T00:00:00.000Z";
      return { body: { agreedAt } };
    },
    ...routes,
  };
}

describe("ShareJoinRoute (/s/:token)", () => {
  let api: FakeApi | null = null;
  const shared = {
    ...SEED_PRESENTATIONS[0],
    userId: OWNER,
    access: { ownerName: "인도자", memberId: SEED_USER_ID },
  } as PresentationDocument;

  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    localStorage.clear();
    agreedAt = "2026-09-01T00:00:00.000Z";
  });

  afterEach(() => api?.restore());

  it("링크로 받은 세트를 로컬에 넣고 편집기로 보낸다", async () => {
    api = installFakeApi(
      withConsent({
        "POST /api/share/*/join": () => ({
          body: { presentationId: shared.id, role: "viewer", document: shared },
        }),
      }),
    );
    renderAt("/s/tok-first");

    expect(await screen.findByTestId("editor-probe")).toHaveTextContent(
      shared.id,
    );
    expect(getPresentationById(shared.id)).toMatchObject({
      access: { ownerName: "인도자" },
    });
    expect(screen.getByTestId("editor-probe")).toHaveAttribute(
      "data-search",
      "",
    );
  });

  it("로그인 전에 사본 만들기를 눌렀으면 편집기에서 사본 만들기를 이어서 연다", async () => {
    api = installFakeApi(
      withConsent({
        "POST /api/share/*/join": () => ({
          body: { presentationId: shared.id, role: "viewer", document: shared },
        }),
      }),
    );
    renderAt("/s/tok-first?copy=1");

    expect(await screen.findByTestId("editor-probe")).toHaveAttribute(
      "data-search",
      "copy=1",
    );
  });

  it("만료된 링크는 안내를 보여 준다", async () => {
    api = installFakeApi(
      withConsent({
        "POST /api/share/*/join": () => ({
          status: 404,
          body: { error: API_ERRORS.share.linkUnavailable },
        }),
      }),
    );
    renderAt("/s/expired");

    expect(await screen.findByTestId("share-link-error")).toHaveTextContent(
      API_ERRORS.share.linkUnavailable,
    );
    expect(
      screen.queryByRole("button", { name: COMMON_COPY.retry }),
    ).not.toBeInTheDocument();
  });

  it("가입 동의 전에는 링크 참여를 미루고, 동의하면 이어서 참여한다", async () => {
    agreedAt = null;
    api = installFakeApi(
      withConsent({
        "POST /api/share/*/join": () => ({
          body: { presentationId: shared.id, role: "viewer", document: shared },
        }),
      }),
    );
    renderAt("/s/tok-new-member");

    fireEvent.click(await screen.findByTestId("consent-all"));
    expect(api.calls.some((call) => call.path.endsWith("/join"))).toBe(false);
    fireEvent.click(screen.getByTestId("consent-agree"));

    expect(await screen.findByTestId("editor-probe")).toHaveTextContent(
      shared.id,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument(),
    );
    const paths = api.calls.map((call) => `${call.method} ${call.path}`);
    expect(paths.indexOf("POST /api/consent")).toBeLessThan(
      paths.indexOf("POST /api/share/tok-new-member/join"),
    );
  });

  it("동의 상태를 몰라 참여했다가 동의가 필요하다고 거절되면, 동의 창을 띄우고 동의하면 다시 참여한다", async () => {
    agreedAt = null;
    let consentChecks = 0;
    api = installFakeApi(
      withConsent({
        "GET /api/consent": () => {
          consentChecks += 1;
          return consentChecks === 1
            ? { status: 503, body: { error: API_ERRORS.serverBusy } }
            : { body: { agreedAt } };
        },
        "POST /api/share/*/join": () =>
          agreedAt
            ? {
                body: {
                  presentationId: shared.id,
                  role: "viewer",
                  document: shared,
                },
              }
            : { status: 403, body: { error: API_ERRORS.consentRequired } },
      }),
    );
    renderAt("/s/tok-unknown-consent");

    fireEvent.click(await screen.findByTestId("consent-all"));
    fireEvent.click(screen.getByTestId("consent-agree"));

    expect(await screen.findByTestId("editor-probe")).toHaveTextContent(
      shared.id,
    );
    expect(
      api.calls.filter((call) => call.path.endsWith("/join")),
    ).toHaveLength(2);
  });

  describe("소유자가 자기 링크를 열 때", () => {
    const local = {
      ...SEED_PRESENTATIONS[0],
      userId: SEED_USER_ID,
      title: "로컬 수정",
    };

    function joinAsOwner(): FakeApi {
      return installFakeApi(
        withConsent({
          "POST /api/share/*/join": () => ({
            body: {
              presentationId: local.id,
              role: "owner",
              document: { ...local, title: "서버" },
            },
          }),
        }),
      );
    }

    it("이 기기에 올리지 못한 변경이 있으면 서버 판으로 덮지 않는다", async () => {
      __loadDocumentsForTests([local]);
      api = joinAsOwner();
      renderAt("/s/tok-own");

      expect(await screen.findByTestId("editor-probe")).toHaveTextContent(
        local.id,
      );
      expect(getPresentationById(local.id)?.title).toBe("로컬 수정");
    });

    it("다른 기기에서 처음 열면 서버 판을 넣는다", async () => {
      api = joinAsOwner();
      renderAt("/s/tok-own");

      expect(await screen.findByTestId("editor-probe")).toHaveTextContent(
        local.id,
      );
      expect(getPresentationById(local.id)?.title).toBe("서버");
    });
  });

  describe("서버에 닿지 못할 때 전에 참여한 링크", () => {
    const joinViewer: Record<string, FakeRoute> = {
      "POST /api/share/*/join": () => ({
        body: { presentationId: shared.id, role: "viewer", document: shared },
      }),
    };

    async function joinOnline(path = "/s/tok-first"): Promise<void> {
      api = installFakeApi(withConsent(joinViewer));
      const joined = renderAt(path);
      await screen.findByTestId("editor-probe");
      joined.unmount();
      api.restore();
    }

    it("오프라인이어도 저장된 사본으로 편집기를 연다", async () => {
      await joinOnline();
      api = installFakeApi({}, { offline: true });

      renderAt("/s/tok-first");

      expect(await screen.findByTestId("editor-probe")).toHaveTextContent(
        shared.id,
      );
      expect(screen.queryByTestId("share-link-error")).not.toBeInTheDocument();
    });

    it("서버가 잠시 응답하지 못해도(503) 저장된 사본을 연다", async () => {
      await joinOnline();
      api = installFakeApi(
        withConsent({
          "POST /api/share/*/join": () => ({
            status: 503,
            body: { error: API_ERRORS.serverBusy },
          }),
        }),
      );

      renderAt("/s/tok-first");

      expect(await screen.findByTestId("editor-probe")).toHaveTextContent(
        shared.id,
      );
    });

    it("로그인 전에 눌러 둔 사본 만들기(?copy=1)를 저장된 사본으로 이어 간다", async () => {
      await joinOnline();
      api = installFakeApi({}, { offline: true });

      renderAt("/s/tok-first?copy=1");

      expect(await screen.findByTestId("editor-probe")).toHaveAttribute(
        "data-search",
        "copy=1",
      );
    });

    it("소유자는 오프라인에서 자기 링크를 열어도 사본 만들기를 붙이지 않는다", async () => {
      const own = { ...SEED_PRESENTATIONS[0], userId: SEED_USER_ID };
      __loadDocumentsForTests([own]);
      rememberJoinedShare(SEED_USER_ID, "tok-own", own.id);
      api = installFakeApi({}, { offline: true });

      renderAt("/s/tok-own?copy=1");

      expect(await screen.findByTestId("editor-probe")).toHaveAttribute(
        "data-search",
        "",
      );
    });

    it("처음 여는 링크는 저장된 사본이 없어 오프라인 안내를 보여 준다", async () => {
      api = installFakeApi({}, { offline: true });

      renderAt("/s/tok-never-joined");

      expect(await screen.findByTestId("share-link-error")).toHaveTextContent(
        ERROR_COPY.offline,
      );
      expect(screen.queryByTestId("editor-probe")).not.toBeInTheDocument();
    });

    it("서버가 링크를 열 수 없다고 하면(404) 저장된 사본이 있어도 열지 않고, 이후 오프라인에서도 열지 않는다", async () => {
      await joinOnline();
      api = installFakeApi(
        withConsent({
          "POST /api/share/*/join": () => ({
            status: 404,
            body: { error: API_ERRORS.share.linkUnavailable },
          }),
        }),
      );
      const revoked = renderAt("/s/tok-first");
      expect(await screen.findByTestId("share-link-error")).toHaveTextContent(
        API_ERRORS.share.linkUnavailable,
      );
      expect(screen.queryByTestId("editor-probe")).not.toBeInTheDocument();
      revoked.unmount();
      api.restore();

      api = installFakeApi({}, { offline: true });
      renderAt("/s/tok-first");

      expect(await screen.findByTestId("share-link-error")).toHaveTextContent(
        ERROR_COPY.offline,
      );
      expect(screen.queryByTestId("editor-probe")).not.toBeInTheDocument();
    });

    it.each([
      [401, API_ERRORS.loginRequired],
      [403, API_ERRORS.consentRequired],
    ])(
      "서버가 거절하면(%i) 저장된 사본이 있어도 열지 않고 다시 시도도 두지 않는다",
      async (status, error) => {
        await joinOnline();
        api = installFakeApi(
          withConsent({
            "POST /api/share/*/join": () => ({ status, body: { error } }),
          }),
        );

        renderAt("/s/tok-first");

        expect(
          await screen.findByTestId("share-link-error"),
        ).toBeInTheDocument();
        expect(screen.queryByTestId("editor-probe")).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: COMMON_COPY.retry }),
        ).not.toBeInTheDocument();
      },
    );

    it("저장된 사본이 이 기기에서 사라졌으면 열지 않는다", async () => {
      await joinOnline();
      resetPresentationStore();
      api = installFakeApi({}, { offline: true });

      renderAt("/s/tok-first");

      expect(await screen.findByTestId("share-link-error")).toHaveTextContent(
        ERROR_COPY.offline,
      );
    });

    it("다른 계정이 참여한 기록으로는 열지 않는다", async () => {
      await joinOnline();
      signInAsTestUser("999999999999999999999");
      api = installFakeApi({}, { offline: true });

      renderAt("/s/tok-first");

      expect(await screen.findByTestId("share-link-error")).toHaveTextContent(
        ERROR_COPY.offline,
      );
    });

    it("기록이 가리키는 사본이 내 것이 아니면 열지 않는다", async () => {
      const other = "999999999999999999999";
      signInAsTestUser(other);
      __loadDocumentsForTests([shared]);
      rememberJoinedShare(other, "tok-first", shared.id);
      api = installFakeApi({}, { offline: true });

      renderAt("/s/tok-first");

      expect(await screen.findByTestId("share-link-error")).toHaveTextContent(
        ERROR_COPY.offline,
      );
    });
  });

  describe("서버가 잠시 응답하지 못할 때", () => {
    it("한국어 안내와 다시 시도를 보여 주고, 다시 시도하면 다시 참여한다", async () => {
      let busy = true;
      api = installFakeApi(
        withConsent({
          "POST /api/share/*/join": () =>
            busy
              ? { status: 503, body: { error: API_ERRORS.serverBusy } }
              : {
                  body: {
                    presentationId: shared.id,
                    role: "viewer",
                    document: shared,
                  },
                },
        }),
      );
      renderAt("/s/tok-busy");

      expect(await screen.findByTestId("share-link-error")).toHaveTextContent(
        API_ERRORS.serverBusy,
      );
      busy = false;
      fireEvent.click(screen.getByRole("button", { name: COMMON_COPY.retry }));

      expect(await screen.findByTestId("editor-probe")).toHaveTextContent(
        shared.id,
      );
      expect(
        api.calls.filter((call) => call.path.endsWith("/join")),
      ).toHaveLength(2);
    });

    it("다시 시도해도 실패하면 안내를 다시 보여 주고 내 프레젠테이션으로 갈 수 있다", async () => {
      api = installFakeApi(
        withConsent({
          "POST /api/share/*/join": () => ({
            status: 503,
            body: { error: API_ERRORS.serverBusy },
          }),
        }),
      );
      renderAt("/s/tok-busy");
      await screen.findByTestId("share-link-error");

      fireEvent.click(screen.getByRole("button", { name: COMMON_COPY.retry }));

      await waitFor(() =>
        expect(
          api?.calls.filter((call) => call.path.endsWith("/join")),
        ).toHaveLength(2),
      );
      expect(await screen.findByTestId("share-link-error")).toHaveTextContent(
        API_ERRORS.serverBusy,
      );
      expect(
        screen.getByRole("button", {
          name: SHARE_LINK_COPY.goToPresentations,
        }),
      ).toBeInTheDocument();
    });

    it("오프라인이면 다시 시도를 보여 주고, 연결된 뒤 다시 시도하면 참여한다", async () => {
      api = installFakeApi({}, { offline: true });
      renderAt("/s/tok-offline");
      expect(await screen.findByTestId("share-link-error")).toHaveTextContent(
        ERROR_COPY.offline,
      );
      api.restore();
      api = installFakeApi(
        withConsent({
          "POST /api/share/*/join": () => ({
            body: {
              presentationId: shared.id,
              role: "viewer",
              document: shared,
            },
          }),
        }),
      );

      fireEvent.click(screen.getByRole("button", { name: COMMON_COPY.retry }));

      expect(await screen.findByTestId("editor-probe")).toHaveTextContent(
        shared.id,
      );
    });
  });
});
