import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoginRoute } from "./LoginRoute";

const signInWithProvider = vi.fn();
const signInAsDeveloper = vi.fn();
const fetchAuthConfig = vi.fn();

vi.mock("../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../lib/auth/authClient")>(
    "../lib/auth/authClient",
  );
  return {
    SOCIAL_PROVIDERS: actual.SOCIAL_PROVIDERS,
    signInWithProvider: (...args: unknown[]) => signInWithProvider(...args),
    signInAsDeveloper: (...args: unknown[]) => signInAsDeveloper(...args),
    fetchAuthConfig: () => fetchAuthConfig(),
  };
});

describe("LoginRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInWithProvider.mockResolvedValue(undefined);
    signInAsDeveloper.mockResolvedValue(undefined);
    fetchAuthConfig.mockResolvedValue({
      providers: ["kakao", "naver"],
      devLogin: false,
    });
  });

  it("로그인이 왜 필요한지 설명한다", async () => {
    render(<LoginRoute />);
    expect(await screen.findByText(/어디서든/)).toBeInTheDocument();
  });

  it("서버가 알려 준 프로바이더만 버튼으로 그린다", async () => {
    fetchAuthConfig.mockResolvedValue({
      providers: ["kakao"],
      devLogin: false,
    });
    render(<LoginRoute />);

    expect(
      await screen.findByRole("button", { name: /카카오로 시작하기/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /네이버로 시작하기/ }),
    ).not.toBeInTheDocument();
  });

  it("버튼을 누르면 해당 provider로 로그인을 시작한다", async () => {
    render(<LoginRoute />);

    fireEvent.click(
      await screen.findByRole("button", { name: /카카오로 시작하기/ }),
    );

    await waitFor(() => {
      expect(signInWithProvider).toHaveBeenCalledWith("kakao");
    });
  });

  it("로그인 시작이 실패하면 안내를 띄우고 다시 시도할 수 있다", async () => {
    signInWithProvider.mockRejectedValue(new Error("network"));
    render(<LoginRoute />);

    fireEvent.click(
      await screen.findByRole("button", { name: /네이버로 시작하기/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/다시 시도/);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /네이버로 시작하기/ }),
      ).toBeEnabled();
    });
  });

  describe("개발자 로그인", () => {
    beforeEach(() => {
      fetchAuthConfig.mockResolvedValue({ providers: [], devLogin: true });
    });

    it("켜져 있으면 버튼과 개발용 표시를 함께 보여준다", async () => {
      render(<LoginRoute />);

      expect(await screen.findByTestId("dev-login")).toBeInTheDocument();
      expect(screen.getByText("개발용")).toBeInTheDocument();
      expect(screen.getByText(/localhost/)).toBeInTheDocument();
    });

    it("꺼져 있으면 노출하지 않는다", async () => {
      fetchAuthConfig.mockResolvedValue({
        providers: ["kakao"],
        devLogin: false,
      });
      render(<LoginRoute />);

      await screen.findByRole("button", { name: /카카오로 시작하기/ });
      expect(screen.queryByTestId("dev-login")).not.toBeInTheDocument();
    });

    it("이메일을 비우면 기본 계정으로 로그인한다", async () => {
      render(<LoginRoute />);

      fireEvent.click(
        await screen.findByRole("button", { name: "개발자 로그인" }),
      );

      await waitFor(() => {
        expect(signInAsDeveloper).toHaveBeenCalledWith(undefined);
      });
    });

    it("이메일을 넣으면 그 계정으로 로그인한다", async () => {
      render(<LoginRoute />);

      fireEvent.change(await screen.findByLabelText("개발자 계정 이메일"), {
        target: { value: "b@dev.local" },
      });
      fireEvent.click(screen.getByRole("button", { name: "개발자 로그인" }));

      await waitFor(() => {
        expect(signInAsDeveloper).toHaveBeenCalledWith("b@dev.local");
      });
    });

    it("실패하면 안내를 띄운다", async () => {
      signInAsDeveloper.mockRejectedValue(new Error("boom"));
      render(<LoginRoute />);

      fireEvent.click(
        await screen.findByRole("button", { name: "개발자 로그인" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /개발자 로그인에 실패/,
      );
    });
  });

  it("로그인 수단이 하나도 없으면 그 사실을 알린다", async () => {
    fetchAuthConfig.mockResolvedValue({ providers: [], devLogin: false });
    render(<LoginRoute />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /사용 가능한 로그인 수단이 없습니다/,
    );
  });

  it("설정을 못 읽어도 화면은 뜬다", async () => {
    fetchAuthConfig.mockRejectedValue(new Error("offline"));
    render(<LoginRoute />);

    expect(
      await screen.findByRole("button", { name: /카카오로 시작하기/ }),
    ).toBeInTheDocument();
  });
});
