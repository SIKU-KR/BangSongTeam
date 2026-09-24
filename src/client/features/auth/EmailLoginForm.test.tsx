import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmailLoginForm } from "./EmailLoginForm";
import { EmailAuthError } from "../../lib/auth/emailAuth";

const signInWithEmail = vi.fn();
const signUpWithEmail = vi.fn();

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/auth/emailAuth")
  >("../../lib/auth/emailAuth");
  return {
    EmailAuthError: actual.EmailAuthError,
    signInWithEmail: (...args: unknown[]) => signInWithEmail(...args),
    signUpWithEmail: (...args: unknown[]) => signUpWithEmail(...args),
  };
});

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function switchToSignUp(): void {
  fireEvent.click(screen.getByRole("button", { name: "가입" }));
}

describe("EmailLoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInWithEmail.mockResolvedValue(undefined);
    signUpWithEmail.mockResolvedValue(undefined);
  });

  it("로그인 탭은 이메일과 비밀번호로 로그인한다", async () => {
    render(<EmailLoginForm />);

    expect(screen.queryByLabelText("이름")).not.toBeInTheDocument();
    fill("이메일", "  team@example.com ");
    fill("비밀번호", "password-1234");
    fireEvent.click(screen.getByRole("button", { name: "이메일로 로그인" }));

    await waitFor(() => {
      expect(signInWithEmail).toHaveBeenCalledWith(
        "team@example.com",
        "password-1234",
      );
    });
  });

  it("틀린 비밀번호는 알아볼 수 있는 문구로 알린다", async () => {
    signInWithEmail.mockRejectedValue(
      new EmailAuthError("invalid-credentials"),
    );
    render(<EmailLoginForm />);

    fill("이메일", "team@example.com");
    fill("비밀번호", "wrong-password");
    fireEvent.click(screen.getByRole("button", { name: "이메일로 로그인" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이메일 또는 비밀번호가 맞지 않습니다",
    );
    expect(
      screen.getByRole("button", { name: "이메일로 로그인" }),
    ).toBeEnabled();
  });

  it("가입 탭은 이름을 받고 정규화된 요청으로 가입한다", async () => {
    render(<EmailLoginForm />);

    switchToSignUp();
    expect(screen.getByText(/허용된 이메일만/)).toBeInTheDocument();
    fill("이름", " 찬양팀 ");
    fill("이메일", "Team@Example.com");
    fill("비밀번호", "password-1234");
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));

    await waitFor(() => {
      expect(signUpWithEmail).toHaveBeenCalledWith({
        name: "찬양팀",
        email: "team@example.com",
        password: "password-1234",
      });
    });
  });

  it("가입 전에 짧은 비밀번호를 걸러 낸다", async () => {
    render(<EmailLoginForm />);

    switchToSignUp();
    fill("이름", "찬양팀");
    fill("이메일", "team@example.com");
    fill("비밀번호", "short");
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/8자 이상/);
    expect(signUpWithEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["not-allowed", "가입이 허용되지 않은 이메일입니다"],
    ["already-exists", "이미 가입된 이메일입니다"],
    ["rate-limited", "잠시 후 다시 시도해 주세요"],
    ["network", "서버에 연결할 수 없습니다"],
  ] as const)("가입 실패(%s)를 문구로 알린다", async (reason, message) => {
    signUpWithEmail.mockRejectedValue(new EmailAuthError(reason));
    render(<EmailLoginForm />);

    switchToSignUp();
    fill("이름", "찬양팀");
    fill("이메일", "team@example.com");
    fill("비밀번호", "password-1234");
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("요청 중에는 버튼을 잠근다", async () => {
    signInWithEmail.mockReturnValue(new Promise(() => {}));
    render(<EmailLoginForm />);

    fill("이메일", "team@example.com");
    fill("비밀번호", "password-1234");
    fireEvent.click(screen.getByRole("button", { name: "이메일로 로그인" }));

    expect(
      await screen.findByRole("button", { name: "로그인 중…" }),
    ).toBeDisabled();
  });

  it("탭을 바꾸면 이전 오류를 지운다", async () => {
    signInWithEmail.mockRejectedValue(
      new EmailAuthError("invalid-credentials"),
    );
    render(<EmailLoginForm />);

    fill("이메일", "team@example.com");
    fill("비밀번호", "wrong-password");
    fireEvent.click(screen.getByRole("button", { name: "이메일로 로그인" }));
    await screen.findByRole("alert");

    switchToSignUp();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
