import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoginRoute } from "./LoginRoute";

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
    signInWithProvider.mockReset();
    signInWithProvider.mockResolvedValue(undefined);
  });

  it("카카오·네이버 로그인 버튼을 보여준다", () => {
    render(<LoginRoute />);

    expect(
      screen.getByRole("button", { name: /카카오로 시작하기/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /네이버로 시작하기/ }),
    ).toBeInTheDocument();
  });

  it("로그인이 왜 필요한지 설명한다", () => {
    render(<LoginRoute />);
    expect(screen.getByText(/어디서든/)).toBeInTheDocument();
  });

  it("버튼을 누르면 해당 provider로 로그인을 시작한다", async () => {
    render(<LoginRoute />);

    fireEvent.click(screen.getByRole("button", { name: /카카오로 시작하기/ }));

    await waitFor(() => {
      expect(signInWithProvider).toHaveBeenCalledWith("kakao");
    });
  });

  it("로그인 시작이 실패하면 안내를 띄우고 다시 시도할 수 있다", async () => {
    signInWithProvider.mockRejectedValue(new Error("network"));
    render(<LoginRoute />);

    fireEvent.click(screen.getByRole("button", { name: /네이버로 시작하기/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/다시 시도/);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /네이버로 시작하기/ }),
      ).toBeEnabled();
    });
  });
});
