import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { MemoryRouter } from "../../test/router";
import { AUTH_COPY } from "#copy/auth";
import { signOut } from "../../lib/auth";
import {
  CONSENT_RECHECK_BASE_MS,
  CONSENT_RECHECK_MAX_MS,
} from "../../lib/api/consentQueries";
import { signInAsTestUser } from "../../test/sessionFixture";
import { withQueryClient } from "../../test/queryClientFixture";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { ConsentGate } from "./ConsentGate";

vi.mock("../../lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/auth")>()),
  signOut: vi.fn(async () => undefined),
}));

function renderGate(path = "/presentations"): void {
  render(
    withQueryClient(
      <MemoryRouter initialEntries={[path]}>
        <ConsentGate />
      </MemoryRouter>,
    ),
  );
}

describe("ConsentGate (가입 동의 모달)", () => {
  let api: FakeApi;
  let agreedAt: string | null;

  beforeEach(() => {
    vi.mocked(signOut).mockClear();
    signInAsTestUser();
    agreedAt = null;
    api = installFakeApi({
      "GET /api/consent": () => ({ body: { agreedAt } }),
      "POST /api/consent": () => {
        agreedAt = "2026-09-27T00:00:00.000Z";
        return { body: { agreedAt } };
      },
    });
  });

  afterEach(() => api.restore());

  it("동의하지 않은 사용자에게 모달을 띄우고, 필수 항목을 모두 체크해야 동의할 수 있다", async () => {
    renderGate();

    expect(await screen.findByTestId("consent-dialog")).toBeInTheDocument();
    const agree = screen.getByTestId("consent-agree");
    expect(agree).toBeDisabled();

    fireEvent.click(screen.getByTestId("consent-ageOver14"));
    fireEvent.click(screen.getByTestId("consent-terms"));
    expect(agree).toBeDisabled();

    fireEvent.click(screen.getByTestId("consent-privacy"));
    expect(agree).toBeEnabled();
  });

  it("전체 동의 후 동의하면 기록하고 모달을 닫는다", async () => {
    renderGate();

    fireEvent.click(await screen.findByTestId("consent-all"));
    fireEvent.click(screen.getByTestId("consent-agree"));

    await waitFor(() =>
      expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument(),
    );
    expect(api.calls).toContainEqual(
      expect.objectContaining({
        method: "POST",
        path: "/api/consent",
        body: { ageOver14: true, terms: true, privacy: true },
      }),
    );
  });

  it("이미 동의한 사용자에게는 띄우지 않는다", async () => {
    agreedAt = "2026-09-01T00:00:00.000Z";
    renderGate();

    await waitFor(() =>
      expect(api.calls.some((call) => call.path === "/api/consent")).toBe(true),
    );
    expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument();
  });

  it.each(["/present/p1/fullscreen", "/terms", "/privacy"])(
    "%s에서는 동의 상태를 묻지 않는다",
    (path) => {
      renderGate(path);
      expect(api.calls).toHaveLength(0);
      expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument();
    },
  );

  it("동의하지 않음을 누르면 로그아웃한다", async () => {
    renderGate();

    fireEvent.click(await screen.findByTestId("consent-decline"));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(AUTH_COPY.signOutFailed)).not.toBeInTheDocument();
  });

  it("동의하지 않음으로 로그아웃하지 못하면 대화 상자에서 알린다", async () => {
    vi.mocked(signOut).mockRejectedValueOnce(
      new Error(AUTH_COPY.signOutFailed),
    );
    renderGate();

    fireEvent.click(await screen.findByTestId("consent-decline"));

    expect(
      await within(screen.getByTestId("consent-dialog")).findByText(
        AUTH_COPY.signOutFailed,
      ),
    ).toBeInTheDocument();
  });

  it("로그아웃하지 못한 뒤 다시 누르면 앞선 실패 안내를 지우고 다시 로그아웃한다", async () => {
    vi.mocked(signOut)
      .mockRejectedValueOnce(new Error(AUTH_COPY.signOutFailed))
      .mockReturnValueOnce(new Promise<void>(() => undefined));
    renderGate();

    const decline = await screen.findByTestId("consent-decline");
    fireEvent.click(decline);
    expect(
      await screen.findByText(AUTH_COPY.signOutFailed),
    ).toBeInTheDocument();

    fireEvent.click(decline);

    expect(signOut).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(AUTH_COPY.signOutFailed)).not.toBeInTheDocument();
  });

  it("로그아웃하지 못한 뒤 동의하면 로그아웃 실패 안내를 지운다", async () => {
    vi.mocked(signOut).mockRejectedValueOnce(
      new Error(AUTH_COPY.signOutFailed),
    );
    renderGate();

    fireEvent.click(await screen.findByTestId("consent-decline"));
    expect(
      await screen.findByText(AUTH_COPY.signOutFailed),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("consent-all"));
    fireEvent.click(screen.getByTestId("consent-agree"));

    expect(screen.getByTestId("consent-dialog")).toBeInTheDocument();
    expect(screen.queryByText(AUTH_COPY.signOutFailed)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument(),
    );
  });

  describe("동의 상태를 확인하지 못할 때", () => {
    async function advance(ms: number): Promise<void> {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    function consentChecks(): number {
      return api.calls.filter((call) => call.path === "/api/consent").length;
    }

    beforeEach(() => {
      api.restore();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      onlineManager.setOnline(true);
    });

    it("서버 오류로 확인하지 못해도 동의 창으로 막지 않는다", async () => {
      api = installFakeApi({
        "GET /api/consent": () => ({ status: 503, body: {} }),
      });
      renderGate();

      await advance(0);

      expect(consentChecks()).toBe(1);
      expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument();
    });

    it("오프라인이면 확인 요청을 보내지 않고 동의 창으로 막지 않는다", async () => {
      api = installFakeApi({
        "GET /api/consent": () => ({ body: { agreedAt: null } }),
      });
      onlineManager.setOnline(false);
      renderGate();

      await advance(CONSENT_RECHECK_MAX_MS);

      expect(api.calls).toHaveLength(0);
      expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument();
    });

    it("오프라인이었다가 연결이 돌아오면 확인하고, 동의 전이면 동의 창을 띄운다", async () => {
      api = installFakeApi({
        "GET /api/consent": () => ({ body: { agreedAt: null } }),
      });
      onlineManager.setOnline(false);
      renderGate();
      await advance(0);

      act(() => onlineManager.setOnline(true));
      await advance(0);

      expect(consentChecks()).toBe(1);
      expect(screen.getByTestId("consent-dialog")).toBeInTheDocument();
    });

    it("첫 확인이 일시적으로 실패해도 다시 확인해, 새로고침 없이 동의 창을 띄운다", async () => {
      api = installFakeApi({
        "GET /api/consent": () =>
          consentChecks() === 1
            ? { status: 503, body: {} }
            : { body: { agreedAt: null } },
      });
      renderGate();
      await advance(0);
      expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument();

      await advance(CONSENT_RECHECK_BASE_MS);
      await advance(100);

      expect(consentChecks()).toBe(2);
      expect(screen.getByTestId("consent-dialog")).toBeInTheDocument();
    });

    it("다시 확인해 이미 동의했다는 걸 알면 더 확인하지 않는다", async () => {
      api = installFakeApi({
        "GET /api/consent": () =>
          consentChecks() === 1
            ? { status: 503, body: {} }
            : { body: { agreedAt: "2026-09-01T00:00:00.000Z" } },
      });
      renderGate();
      await advance(0);

      await advance(CONSENT_RECHECK_BASE_MS);
      await advance(10 * CONSENT_RECHECK_MAX_MS);

      expect(consentChecks()).toBe(2);
      expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument();
    });

    it("실패가 이어지면 확인 간격을 늘리되 상한을 넘기지 않는다", async () => {
      const checkedAt: number[] = [];
      api = installFakeApi({
        "GET /api/consent": () => {
          checkedAt.push(Date.now());
          return { status: 503, body: {} };
        },
      });
      renderGate();
      await advance(0);

      await advance(30 * 60_000);

      const gaps = checkedAt
        .slice(1)
        .map((at, index) => at - (checkedAt[index] ?? 0));
      expect(gaps[0]).toBe(CONSENT_RECHECK_BASE_MS);
      expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
      expect(gaps.at(-1)).toBe(CONSENT_RECHECK_MAX_MS);
      expect(new Set(gaps).size).toBeGreaterThan(3);
    });

    it.each([401, 403, 404])(
      "서버가 %s로 거절하면 다시 확인해도 같으므로 더 확인하지 않는다",
      async (status) => {
        api = installFakeApi({
          "GET /api/consent": () => ({ status, body: {} }),
        });
        renderGate();
        await advance(0);

        await advance(10 * CONSENT_RECHECK_MAX_MS);

        expect(consentChecks()).toBe(1);
        expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument();
      },
    );
  });
});
