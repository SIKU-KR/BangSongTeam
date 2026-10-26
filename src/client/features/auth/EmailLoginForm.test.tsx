import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_COPY } from "#copy/auth";
import { EmailLoginForm } from "./EmailLoginForm";
import { EmailAuthError } from "../../lib/auth/sessionStore";

const signInWithEmail = vi.fn();
const signUpWithEmail = vi.fn();

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/auth/sessionStore")
  >("../../lib/auth/sessionStore");
  return {
    EmailAuthError: actual.EmailAuthError,
    signInWithEmail: (...args: unknown[]) => signInWithEmail(...args),
    signUpWithEmail: (...args: unknown[]) => signUpWithEmail(...args),
  };
});

const COPY = AUTH_COPY.email;

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function switchToSignUp(): void {
  fireEvent.click(screen.getByRole("button", { name: COPY.signUp }));
}

describe("EmailLoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInWithEmail.mockResolvedValue(undefined);
    signUpWithEmail.mockResolvedValue(undefined);
  });

  it("로그인은 이메일과 비밀번호만 받아 로그인한다", async () => {
    render(<EmailLoginForm />);

    expect(screen.queryByLabelText(COPY.name)).not.toBeInTheDocument();
    fill(COPY.emailField, "  team@example.com ");
    fill(COPY.password, "password-1234");
    fireEvent.click(screen.getByRole("button", { name: COPY.submitSignIn }));

    await waitFor(() => {
      expect(signInWithEmail).toHaveBeenCalledWith(
        "team@example.com",
        "password-1234",
      );
    });
  });

  it("틀린 비밀번호는 다시 확인하라고 알린다", async () => {
    signInWithEmail.mockRejectedValue(new EmailAuthError("invalidCredentials"));
    render(<EmailLoginForm />);

    fill(COPY.emailField, "team@example.com");
    fill(COPY.password, "wrong-password");
    fireEvent.click(screen.getByRole("button", { name: COPY.submitSignIn }));

    expect(
      await screen.findByText(COPY.failures.invalidCredentials),
    ).toBeInTheDocument();
  });

  it("가입은 이름까지 받아 가입 요청을 보낸다", async () => {
    render(<EmailLoginForm />);

    switchToSignUp();
    fill(COPY.name, "찬양팀");
    fill(COPY.emailField, "team@example.com");
    fill(COPY.password, "password-1234");
    fireEvent.click(screen.getByRole("button", { name: COPY.submitSignUp }));

    await waitFor(() => {
      expect(signUpWithEmail).toHaveBeenCalledWith({
        name: "찬양팀",
        email: "team@example.com",
        password: "password-1234",
      });
    });
  });

  it("너무 짧은 비밀번호는 서버에 보내지 않고 안내한다", async () => {
    render(<EmailLoginForm />);

    switchToSignUp();
    fill(COPY.name, "찬양팀");
    fill(COPY.emailField, "team@example.com");
    fill(COPY.password, "short");
    fireEvent.click(screen.getByRole("button", { name: COPY.submitSignUp }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/비밀번호는/);
    expect(signUpWithEmail).not.toHaveBeenCalled();
  });

  it("이미 가입한 이메일이면 로그인하라고 알린다", async () => {
    signUpWithEmail.mockRejectedValue(new EmailAuthError("alreadyExists"));
    render(<EmailLoginForm />);

    switchToSignUp();
    fill(COPY.name, "찬양팀");
    fill(COPY.emailField, "team@example.com");
    fill(COPY.password, "password-1234");
    fireEvent.click(screen.getByRole("button", { name: COPY.submitSignUp }));

    expect(
      await screen.findByText(COPY.failures.alreadyExists),
    ).toBeInTheDocument();
  });

  it("다른 방식으로 이동하는 동안에는 제출할 수 없다", () => {
    render(<EmailLoginForm disabled />);

    expect(
      screen.getByRole("button", { name: COPY.submitSignIn }),
    ).toBeDisabled();
  });
});
