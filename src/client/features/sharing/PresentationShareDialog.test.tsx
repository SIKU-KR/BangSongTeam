import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { API_ERRORS, type ShareSettings } from "#shared";
import { withQueryClient } from "../../test/queryClientFixture";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { signInAsTestUser } from "../../test/sessionFixture";
import {
  createNewPresentation,
  resetPresentationStore,
} from "../presentation/presentationStore";
import {
  __resetSyncSchedulerForTests,
  setSyncEnabled,
} from "../../lib/sync/syncScheduler";
import { PresentationShareDialog } from "./PresentationShareDialog";
import { SHARING_COPY } from "#copy/sharing";

const ID = "p0000000000000000000a";

function idOf(url: URL): string {
  return url.pathname.split("/")[3];
}

describe("PresentationShareDialog (세트 링크 공유)", () => {
  let api: FakeApi;
  let settings: ShareSettings;

  beforeEach(() => {
    settings = { access: "off", token: null };
    api = installFakeApi({
      "GET /api/presentations/*/share": () => ({ body: settings }),
      "PUT /api/presentations/*/share": ({ body }) => {
        const { access } = body as { access: ShareSettings["access"] };
        settings = { access, token: settings.token ?? "tok-first" };
        return { body: settings };
      },
      "POST /api/presentations/*/share/reset": () => {
        settings = { ...settings, token: "tok-second" };
        return { body: settings };
      },
    });
  });

  afterEach(() => {
    api.restore();
    vi.restoreAllMocks();
    onlineManager.setOnline(true);
  });

  function renderDialog(presentationId = ID) {
    return render(
      withQueryClient(
        <PresentationShareDialog
          presentationId={presentationId}
          title="주일 1부 예배"
          isOpen
          onClose={() => {}}
        />,
      ),
    );
  }

  it("링크가 꺼져 있으면 주소를 보여 주지 않는다", async () => {
    renderDialog();
    expect(await screen.findByTestId("share-access-select")).toHaveTextContent(
      SHARING_COPY.link.accessOptions.off,
    );
    expect(screen.queryByTestId("share-link-input")).not.toBeInTheDocument();
  });

  it("보기 가능으로 바꾸면 /s/ 링크가 나타난다", async () => {
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-access-select"));
    const option = await screen.findByRole("option", {
      name: SHARING_COPY.link.accessOptions.view,
    });
    fireEvent.pointerDown(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);

    await waitFor(() =>
      expect(screen.getByTestId("share-link-input")).toHaveValue(
        `${window.location.origin}/s/tok-first`,
      ),
    );
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({
      access: "view",
    });
  });

  it("링크를 재설정하면 새 주소로 바뀐다", async () => {
    settings = { access: "view", token: "tok-first" };
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-reset-btn"));
    fireEvent.click(await screen.findByTestId("share-reset-confirm-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("share-link-input")).toHaveValue(
        `${window.location.origin}/s/tok-second`,
      ),
    );
  });

  it("링크가 켜져 있으면 로그인하지 않아도 누구나 보고 발표할 수 있다고 알린다", async () => {
    settings = { access: "view", token: "tok-first" };
    renderDialog();

    const hint = await screen.findByText(SHARING_COPY.link.accessHints.view);

    expect(hint).toHaveTextContent("로그인하지 않아도");
    expect(hint).toHaveTextContent("누구나");
    expect(hint).not.toHaveTextContent("로그인한 사람은");
  });

  describe("서버에 아직 없는 프레젠테이션", () => {
    beforeEach(() => {
      signInAsTestUser();
      resetPresentationStore();
      __resetSyncSchedulerForTests();
      setSyncEnabled(true);
    });

    afterEach(() => {
      __resetSyncSchedulerForTests();
      resetPresentationStore();
    });

    it("방금 만든 프레젠테이션은 올리던 변경을 먼저 보낸 뒤 공유 설정을 불러온다", async () => {
      api.restore();
      const uploaded = new Set<string>();
      api = installFakeApi({
        "PATCH /api/presentations/*": ({ url }) => {
          uploaded.add(idOf(url));
          return { body: { ok: true } };
        },
        "GET /api/presentations/*/share": ({ url }) =>
          uploaded.has(idOf(url))
            ? { body: settings }
            : {
                status: 404,
                body: { error: API_ERRORS.presentation.notAccessible },
              },
      });
      const created = createNewPresentation(null);

      renderDialog(created.id);

      const select = await screen.findByTestId("share-access-select");
      expect(select).toBeEnabled();
      expect(select).not.toHaveAttribute("data-disabled");
      expect(
        screen.queryByText(API_ERRORS.presentation.notAccessible),
      ).not.toBeInTheDocument();
      expect(api.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
        `PATCH /api/presentations/${created.id}`,
        `GET /api/presentations/${created.id}/share`,
      ]);
    });

    it("올린 뒤에도 서버에 없으면 열 수 없다고 하지 않고 동기화가 끝난 뒤 다시 열라고 알린다", async () => {
      api.restore();
      api = installFakeApi({
        "GET /api/presentations/*/share": () => ({
          status: 404,
          body: { error: API_ERRORS.presentation.notAccessible },
        }),
      });

      renderDialog();

      expect(
        await screen.findByText(SHARING_COPY.link.notSynced),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(API_ERRORS.presentation.notAccessible),
      ).not.toBeInTheDocument();
      const select = screen.getByTestId("share-access-select");
      expect(select).toBeDisabled();
      expect(select).toHaveAttribute("data-disabled");
    });
  });

  describe("오프라인", () => {
    function goOffline(): void {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      act(() => {
        onlineManager.setOnline(false);
        window.dispatchEvent(new Event("offline"));
      });
    }

    function goOnline(): void {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      act(() => {
        onlineManager.setOnline(true);
        window.dispatchEvent(new Event("online"));
      });
    }

    it("설정을 불러오지 못하고 멈춰 있지 않고 온라인에서만 된다고 알린다", async () => {
      goOffline();

      renderDialog();

      expect(
        await screen.findByText(SHARING_COPY.library.onlineOnly),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("share-access-select"),
      ).not.toBeInTheDocument();
      expect(api.calls).toEqual([]);

      goOnline();

      expect(
        await screen.findByTestId("share-access-select"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(SHARING_COPY.library.onlineOnly),
      ).not.toBeInTheDocument();
    });

    it("불러온 뒤 오프라인이 되면 링크 설정을 바꾸지 못하게 한다", async () => {
      renderDialog();
      expect(await screen.findByTestId("share-access-select")).toBeEnabled();

      goOffline();

      expect(
        await screen.findByText(SHARING_COPY.library.onlineOnly),
      ).toBeInTheDocument();
      expect(screen.getByTestId("share-access-select")).toBeDisabled();
    });
  });
});
