import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SocialProvider } from "#shared";
import { LoginRoute } from "./LoginRoute";
import { AUTH_COPY } from "#copy/auth";
import { ERROR_COPY } from "#copy/common";
import { SHARING_COPY } from "#copy/sharing";
import { SocialSignInError } from "../lib/auth";
import { copyToClipboard } from "../lib/browser/clipboard";
import { clearPersistenceError, reportPersistenceError } from "../lib/storage";
import { PersistenceUnavailableError } from "../lib/storage/db";
import { installFakeApi, type FakeApi } from "../test/fakeApi";
import {
  createTestQueryClient,
  withQueryClient,
} from "../test/queryClientFixture";

const signInWithProvider = vi.fn();

vi.mock("../lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/auth")>()),
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  signInWithProvider: (...args: unknown[]) => signInWithProvider(...args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("../lib/browser/clipboard", () => ({ copyToClipboard: vi.fn() }));

const KAKAOTALK_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36;KAKAOTALK 2410960";
const NAVER_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 1000; 12.9.2; 15PRO)";
const LINE_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.8.0";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

const ALL_PROVIDERS: SocialProvider[] = ["kakao", "naver", "google"];

const originalLocation = Object.getOwnPropertyDescriptor(window, "location");

describe("LoginRoute", () => {
  let api: FakeApi;

  function serveProviders(providers: SocialProvider[]): void {
    api = installFakeApi({
      "GET /api/auth-config": () => ({ body: { providers } }),
    });
  }

  function renderLogin(
    props: React.ComponentProps<typeof LoginRoute> = {},
  ): QueryClient {
    const client = createTestQueryClient();
    render(withQueryClient(<LoginRoute {...props} />, client));
    return client;
  }

  async function configSettled(client: QueryClient): Promise<void> {
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === "/api/auth-config")).toBe(
        true,
      ),
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
  }

  function setUserAgent(userAgent: string): void {
    Object.defineProperty(navigator, "userAgent", {
      value: userAgent,
      configurable: true,
    });
  }

  function stubLocation(href: string): string[] {
    const url = new URL(href);
    const navigations: string[] = [];
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        get href() {
          return url.href;
        },
        set href(next: string) {
          navigations.push(next);
        },
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
        origin: url.origin,
      },
    });
    return navigations;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    signInWithProvider.mockResolvedValue(undefined);
    vi.mocked(copyToClipboard).mockResolvedValue(undefined);
    serveProviders(ALL_PROVIDERS);
  });

  afterEach(() => {
    api.restore();
    clearPersistenceError("session");
    Reflect.deleteProperty(navigator, "userAgent");
    if (originalLocation) {
      Object.defineProperty(window, "location", originalLocation);
    }
    window.history.replaceState(null, "", "/");
  });

  it("로그인이 왜 필요한지 설명한다", async () => {
    renderLogin();
    expect(await screen.findByText(/어디서든/)).toBeInTheDocument();
  });

  describe("화면보다 카드가 긴 작은 화면", () => {
    it("화면 높이만큼의 스크롤 영역이라, 키보드가 올라와 낮아져도 아래 입력란과 버튼까지 밀어서 닿는다", () => {
      renderLogin();

      const root = screen.getByTestId("login-route");

      expect(root).toHaveClass("h-dvh", "overflow-y-auto");
      expect(root).toContainElement(screen.getByTestId("email-login-form"));
    });

    it("카드는 넘치지 않을 때 가운데에 놓이고, 넘칠 때는 위아래에 여백을 두고 이어진다", () => {
      renderLogin();

      const centering = screen
        .getByTestId("email-login-form")
        .closest("[data-slot=card]")?.parentElement;

      expect(centering).toHaveClass(
        "flex-1",
        "items-center",
        "justify-center",
        "p-4",
      );
    });
  });

  describe("소셜 로그인 버튼", () => {
    it("서버가 켜 둔 로그인만 버튼으로 보여 준다", async () => {
      serveProviders(["kakao", "google"]);
      renderLogin();

      expect(
        await screen.findByRole("button", { name: AUTH_COPY.providers.kakao }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: AUTH_COPY.providers.google }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: AUTH_COPY.providers.naver }),
      ).not.toBeInTheDocument();
    });

    it("서버가 모든 소셜 로그인을 켜 두면 카카오, 네이버, Google 순서로 보여 준다", async () => {
      renderLogin();

      await screen.findByRole("button", { name: AUTH_COPY.providers.kakao });
      const labels: string[] = Object.values(AUTH_COPY.providers);
      const order = screen
        .getAllByRole("button")
        .map((button) => button.textContent)
        .filter((text) => labels.includes(text ?? ""));
      expect(order).toEqual([
        AUTH_COPY.providers.kakao,
        AUTH_COPY.providers.naver,
        AUTH_COPY.providers.google,
      ]);
    });

    it("서버가 Google만 켜 두면 카카오·네이버 버튼 없이 Google과 이메일 로그인이 보인다", async () => {
      serveProviders(["google"]);
      const client = renderLogin();
      await configSettled(client);

      expect(
        screen.getByRole("button", { name: AUTH_COPY.providers.google }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: AUTH_COPY.providers.kakao }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: AUTH_COPY.providers.naver }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("email-login-form")).toBeInTheDocument();
    });

    it("서버가 소셜 로그인을 하나도 켜 두지 않았으면 구분선 없이 이메일 로그인만 보인다", async () => {
      serveProviders([]);
      const client = renderLogin();
      await configSettled(client);

      for (const label of Object.values(AUTH_COPY.providers)) {
        expect(
          screen.queryByRole("button", { name: label }),
        ).not.toBeInTheDocument();
      }
      expect(screen.queryByText(AUTH_COPY.email.divider)).toBeNull();
      expect(screen.getByTestId("email-login-form")).toBeInTheDocument();
    });

    it("서버 목록을 받는 동안에는 Google과 이메일 로그인이 먼저 보이고, 받으면 켜 둔 버튼이 나타난다", async () => {
      let answer: () => void = () => undefined;
      const answered = new Promise<void>((resolve) => {
        answer = resolve;
      });
      api.restore();
      api = installFakeApi({
        "GET /api/auth-config": async () => {
          await answered;
          return { body: { providers: ALL_PROVIDERS } };
        },
      });
      renderLogin();

      expect(
        screen.getByRole("button", { name: AUTH_COPY.providers.google }),
      ).toBeEnabled();
      expect(screen.getByTestId("email-login-form")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: AUTH_COPY.providers.kakao }),
      ).not.toBeInTheDocument();

      answer();

      expect(
        await screen.findByRole("button", { name: AUTH_COPY.providers.kakao }),
      ).toBeInTheDocument();
    });

    it.each([
      ["서버가 오류로 답해도", { status: 503, body: {} }],
      ["서버 응답이 형식에 맞지 않아도", { body: { providers: "google" } }],
    ])(
      "%s 카카오·네이버는 숨기고 Google과 이메일 로그인은 그대로 둔다",
      async (_, response) => {
        api.restore();
        api = installFakeApi({ "GET /api/auth-config": () => response });
        const client = renderLogin();
        await configSettled(client);

        expect(
          screen.getByRole("button", { name: AUTH_COPY.providers.google }),
        ).toBeEnabled();
        expect(
          screen.queryByRole("button", { name: AUTH_COPY.providers.kakao }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: AUTH_COPY.providers.naver }),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("email-login-form")).toBeInTheDocument();
      },
    );

    it("서버에 닿지 못해도 카카오·네이버는 숨기고 Google과 이메일 로그인은 그대로 둔다", async () => {
      api.restore();
      api = installFakeApi({}, { offline: true });
      const client = renderLogin();
      await configSettled(client);

      expect(
        screen.getByRole("button", { name: AUTH_COPY.providers.google }),
      ).toBeEnabled();
      expect(
        screen.queryByRole("button", { name: AUTH_COPY.providers.kakao }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("email-login-form")).toBeInTheDocument();
    });

    it("버튼을 누르면 해당 provider로 로그인을 시작한다", async () => {
      renderLogin();

      fireEvent.click(
        await screen.findByRole("button", { name: /카카오 로그인/ }),
      );

      await waitFor(() => {
        expect(signInWithProvider).toHaveBeenCalledWith("kakao");
      });
    });

    it("구글 버튼을 누르면 google로 로그인을 시작한다", async () => {
      renderLogin();

      fireEvent.click(
        await screen.findByRole("button", { name: /Google 계정으로 로그인/ }),
      );

      await waitFor(() => {
        expect(signInWithProvider).toHaveBeenCalledWith("google");
      });
    });

    it("로그인으로 이동하는 동안 모든 소셜 버튼을 막고, 누른 버튼의 레이블은 그대로 둔다", async () => {
      signInWithProvider.mockReturnValue(new Promise(() => {}));
      renderLogin();

      fireEvent.click(
        await screen.findByRole("button", { name: /카카오 로그인/ }),
      );

      const kakao = await screen.findByRole("button", {
        name: AUTH_COPY.providers.kakao,
      });
      await waitFor(() => {
        expect(kakao).toBeDisabled();
      });
      expect(kakao).toHaveAttribute("aria-busy", "true");
      const naver = screen.getByRole("button", {
        name: AUTH_COPY.providers.naver,
      });
      expect(naver).toBeDisabled();
      expect(naver).not.toHaveAttribute("aria-busy");
    });

    it("로그인 시작이 실패하면 안내를 띄우고 다시 시도할 수 있다", async () => {
      signInWithProvider.mockRejectedValue(
        new SocialSignInError(AUTH_COPY.signInFailed),
      );
      renderLogin();

      fireEvent.click(
        await screen.findByRole("button", { name: /네이버 로그인/ }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(/다시 시도/);
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /네이버 로그인/ }),
        ).toBeEnabled();
      });
    });

    it("서버가 등록하지 않은 로그인이라는 안내는 다른 방법으로 로그인하라는 문구 그대로 보여 준다", async () => {
      signInWithProvider.mockRejectedValue(
        new SocialSignInError(AUTH_COPY.providerUnavailable),
      );
      renderLogin();

      fireEvent.click(
        await screen.findByRole("button", { name: AUTH_COPY.providers.google }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        AUTH_COPY.providerUnavailable,
      );
    });

    it("서버에 닿지 못해 던진 오류는 영문 오류 문구 대신 일반 안내로 바꾼다", async () => {
      signInWithProvider.mockRejectedValue(new TypeError("Failed to fetch"));
      renderLogin();

      fireEvent.click(
        await screen.findByRole("button", { name: AUTH_COPY.providers.google }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        AUTH_COPY.signInFailed,
      );
      expect(screen.queryByText(/Failed to fetch/)).toBeNull();
    });

    it("로그인 시작 요청이 시간 제한에 걸리면 안내하고 Google 버튼과 이메일 로그인, 돌아가기를 다시 쓸 수 있게 한다", async () => {
      let timeOut: () => void = () => undefined;
      signInWithProvider.mockReturnValue(
        new Promise<never>((_, reject) => {
          timeOut = () =>
            reject(new DOMException("signal timed out", "TimeoutError"));
        }),
      );
      renderLogin({ onCancel: vi.fn() });

      fireEvent.click(
        await screen.findByRole("button", { name: AUTH_COPY.providers.google }),
      );
      const google = screen.getByRole("button", {
        name: AUTH_COPY.providers.google,
      });
      const emailSubmit = screen.getByRole("button", {
        name: AUTH_COPY.email.submitSignIn,
      });
      const cancel = screen.getByTestId("login-cancel-btn");
      await waitFor(() => {
        expect(emailSubmit).toBeDisabled();
      });
      expect(google).toBeDisabled();
      expect(cancel).toBeDisabled();

      timeOut();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        AUTH_COPY.signInFailed,
      );
      expect(google).toBeEnabled();
      expect(emailSubmit).toBeEnabled();
      expect(cancel).toBeEnabled();
    });
  });

  it("소셜 로그인과 함께 이메일 로그인 폼을 보여 준다", async () => {
    renderLogin();

    expect(await screen.findByTestId("email-login-form")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: AUTH_COPY.email.submitSignIn }),
    ).toBeEnabled();
  });

  it("저장소가 이전 버전 탭에 막혀 있으면 로그인 화면에 다른 탭을 닫으라는 안내를 보여 준다", async () => {
    reportPersistenceError(
      new PersistenceUnavailableError(undefined, "blocked"),
      "session",
    );

    renderLogin();

    expect(
      await screen.findByTestId("storage-warning-banner"),
    ).toHaveTextContent(ERROR_COPY.persistence.blocked);
  });

  describe("소셜 로그인이 도중에 실패해 돌아왔을 때", () => {
    it.each([
      ["account_not_linked", AUTH_COPY.oauthErrors.accountNotLinked],
      ["state_mismatch", AUTH_COPY.oauthErrors.stateExpired],
      ["unable_to_get_user_info", AUTH_COPY.email.failures.unknown],
    ])("오류 코드 %s를 알아듣는 문구로 안내한다", async (code, message) => {
      window.history.replaceState(null, "", `/presentations?error=${code}`);
      renderLogin();

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    });

    it("직접 취소했을 때는 안내하지 않는다", async () => {
      window.history.replaceState(
        null,
        "",
        "/presentations?error=access_denied&error_description=The+user+denied",
      );
      renderLogin();

      await screen.findByTestId("email-login-form");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(window.location.search).toBe("");
    });

    it("안내를 띄운 뒤 주소에서는 오류 코드만 지우고 다른 쿼리는 둔다", async () => {
      window.history.replaceState(
        null,
        "",
        "/s/tok-abc?copy=1&error=account_not_linked&error_description=x",
      );
      renderLogin();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        AUTH_COPY.oauthErrors.accountNotLinked,
      );
      expect(window.location.pathname).toBe("/s/tok-abc");
      expect(window.location.search).toBe("?copy=1");
    });

    it("오류 없이 열면 안내가 없고 주소도 건드리지 않는다", async () => {
      window.history.replaceState(null, "", "/presentations?folder=a");
      renderLogin();

      await screen.findByTestId("email-login-form");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(window.location.search).toBe("?folder=a");
    });

    it("비어 있는 오류 코드는 안내하지 않고 주소에서 지운다", async () => {
      window.history.replaceState(null, "", "/presentations?error=");
      renderLogin();

      await screen.findByTestId("email-login-form");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(window.location.search).toBe("");
    });
  });

  describe("앱 안 브라우저", () => {
    it("카카오톡 안에서는 Google 버튼 대신 다른 브라우저로 열라는 안내를 보인다", async () => {
      setUserAgent(KAKAOTALK_ANDROID);
      const client = renderLogin();
      await configSettled(client);

      const notice = screen.getByTestId("in-app-browser-notice");
      expect(notice).toHaveTextContent(AUTH_COPY.inAppBrowser.notice);
      expect(
        screen.queryByRole("button", { name: AUTH_COPY.providers.google }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("email-login-form")).toBeInTheDocument();
      expect(
        within(notice).getByRole("button", {
          name: AUTH_COPY.inAppBrowser.openExternal,
        }),
      ).toBeEnabled();
      expect(
        within(notice).getByRole("button", {
          name: AUTH_COPY.inAppBrowser.copyLink,
        }),
      ).toBeEnabled();
    });

    it("앱 안에서도 서버가 켜 둔 카카오·네이버 로그인은 그대로 쓸 수 있다", async () => {
      setUserAgent(KAKAOTALK_ANDROID);
      renderLogin();

      expect(
        await screen.findByRole("button", { name: AUTH_COPY.providers.kakao }),
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: AUTH_COPY.providers.naver }),
      ).toBeEnabled();
      expect(screen.getByTestId("in-app-browser-notice")).toBeInTheDocument();
    });

    it("카카오톡의 '다른 브라우저로 열기'는 지금 주소를 그대로 카카오톡 외부 열기 주소로 보낸다", async () => {
      setUserAgent(KAKAOTALK_ANDROID);
      const navigations = stubLocation("https://example.com/s/tok-abc?copy=1");
      renderLogin();

      fireEvent.click(
        await screen.findByRole("button", {
          name: AUTH_COPY.inAppBrowser.openExternal,
        }),
      );

      expect(navigations).toEqual([
        `kakaotalk://web/openExternal?url=${encodeURIComponent("https://example.com/s/tok-abc?copy=1")}`,
      ]);
    });

    it("라인의 '다른 브라우저로 열기'는 지금 주소에 외부 브라우저 표시를 붙여 다시 연다", async () => {
      setUserAgent(LINE_IOS);
      const navigations = stubLocation("https://example.com/presentations");
      renderLogin();

      fireEvent.click(
        await screen.findByRole("button", {
          name: AUTH_COPY.inAppBrowser.openExternal,
        }),
      );

      expect(navigations).toEqual([
        "https://example.com/presentations?openExternalBrowser=1",
      ]);
    });

    it("믿을 만한 열기 방법이 없는 앱에서는 열기 버튼 없이 링크 복사만 둔다", async () => {
      setUserAgent(NAVER_IOS);
      const client = renderLogin();
      await configSettled(client);

      const notice = screen.getByTestId("in-app-browser-notice");
      expect(
        within(notice).queryByRole("button", {
          name: AUTH_COPY.inAppBrowser.openExternal,
        }),
      ).toBeNull();
      expect(
        within(notice).getByRole("button", {
          name: AUTH_COPY.inAppBrowser.copyLink,
        }),
      ).toBeEnabled();
    });

    it("링크 복사는 지금 주소를 복사하고 복사했다고 알린다", async () => {
      setUserAgent(NAVER_IOS);
      stubLocation("https://example.com/s/tok-abc?copy=1");
      renderLogin();

      fireEvent.click(
        await screen.findByRole("button", {
          name: AUTH_COPY.inAppBrowser.copyLink,
        }),
      );

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(SHARING_COPY.link.copied);
      });
      expect(copyToClipboard).toHaveBeenCalledWith(
        "https://example.com/s/tok-abc?copy=1",
      );
    });

    it("링크를 복사하지 못하면 복사하지 못했다고 알린다", async () => {
      setUserAgent(NAVER_IOS);
      vi.mocked(copyToClipboard).mockRejectedValue(new Error("clipboard"));
      renderLogin();

      fireEvent.click(
        await screen.findByRole("button", {
          name: AUTH_COPY.inAppBrowser.copyLink,
        }),
      );

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(SHARING_COPY.link.copyFailed);
      });
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("앱 안 브라우저가 아니면 Google 버튼을 보이고 안내는 띄우지 않는다", async () => {
      setUserAgent(DESKTOP_CHROME);
      const client = renderLogin();
      await configSettled(client);

      expect(
        screen.getByRole("button", { name: AUTH_COPY.providers.google }),
      ).toBeEnabled();
      expect(screen.queryByTestId("in-app-browser-notice")).toBeNull();
    });

    it("서버가 Google을 켜 두지 않았으면 Google 안내도 하지 않는다", async () => {
      setUserAgent(KAKAOTALK_ANDROID);
      serveProviders(["kakao"]);
      const client = renderLogin();
      await configSettled(client);

      expect(screen.queryByTestId("in-app-browser-notice")).toBeNull();
      expect(
        screen.getByRole("button", { name: AUTH_COPY.providers.kakao }),
      ).toBeEnabled();
    });
  });

  describe("뒤로 가기로 되돌아왔을 때", () => {
    async function startGoogleSignIn(): Promise<void> {
      fireEvent.click(
        await screen.findByRole("button", { name: AUTH_COPY.providers.google }),
      );
      await waitFor(() => {
        expect(signInWithProvider).toHaveBeenCalledWith("google");
      });
    }

    function pageshow(persisted: boolean): void {
      act(() => {
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted }),
        );
      });
    }

    it("뒤로 가기·앞으로 가기 캐시에서 복원되면 막아 둔 버튼을 다시 쓸 수 있게 한다", async () => {
      renderLogin({ onCancel: vi.fn() });
      await startGoogleSignIn();
      const google = screen.getByRole("button", {
        name: AUTH_COPY.providers.google,
      });
      const emailSubmit = screen.getByRole("button", {
        name: AUTH_COPY.email.submitSignIn,
      });
      const cancel = screen.getByTestId("login-cancel-btn");
      expect(google).toBeDisabled();
      expect(emailSubmit).toBeDisabled();
      expect(cancel).toBeDisabled();

      pageshow(true);

      expect(google).toBeEnabled();
      expect(google).not.toHaveAttribute("aria-busy");
      expect(emailSubmit).toBeEnabled();
      expect(cancel).toBeEnabled();
    });

    it("캐시에서 복원된 것이 아니면 로그인으로 이동하는 중에는 계속 막아 둔다", async () => {
      renderLogin();
      await startGoogleSignIn();

      pageshow(false);

      expect(
        screen.getByRole("button", { name: AUTH_COPY.providers.google }),
      ).toBeDisabled();
    });
  });
});
