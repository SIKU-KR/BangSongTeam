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
  getPresentationById,
  resetPresentationStore,
} from "../features/presentation/presentationStore";
import { ShareJoinRoute } from "./ShareJoinRoute";
import { API_ERRORS } from "#shared";
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
});
