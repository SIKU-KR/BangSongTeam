import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoginRoute } from "./LoginRoute";
import { AUTH_COPY } from "#copy/auth";

const signInWithProvider = vi.fn();

vi.mock("../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../lib/auth/authClient")>(
    "../lib/auth/authClient",
  );
  return {
    SOCIAL_PROVIDERS: actual.SOCIAL_PROVIDERS,
    signInWithProvider: (...args: unknown[]) => signInWithProvider(...args),
  };
});

describe("LoginRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInWithProvider.mockResolvedValue(undefined);
  });

  it("로그인이 왜 필요한지 설명한다", async () => {
    render(<LoginRoute />);
    expect(await screen.findByText(/어디서든/)).toBeInTheDocument();
  });

  it("버튼을 누르면 해당 provider로 로그인을 시작한다", async () => {
    render(<LoginRoute />);

    fireEvent.click(
      await screen.findByRole("button", { name: /카카오 로그인/ }),
    );

    await waitFor(() => {
      expect(signInWithProvider).toHaveBeenCalledWith("kakao");
    });
  });

  it("구글 버튼을 누르면 google로 로그인을 시작한다", async () => {
    render(<LoginRoute />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Google 계정으로 로그인/ }),
    );

    await waitFor(() => {
      expect(signInWithProvider).toHaveBeenCalledWith("google");
    });
  });

  it("로그인으로 이동하는 동안 모든 소셜 버튼을 막고, 누른 버튼의 레이블은 그대로 둔다", async () => {
    signInWithProvider.mockReturnValue(new Promise(() => {}));
    render(<LoginRoute />);

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
    signInWithProvider.mockRejectedValue(new Error("network"));
    render(<LoginRoute />);

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
});
