import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_COPY } from "#copy/auth";
import { EmailLoginForm } from "./EmailLoginForm";
import { authClient } from "../../lib/auth/authClient";
import {
  EmailAuthError,
  getSessionState,
  signUpWithEmail as signUpThroughSessionStore,
  __resetSessionForTests,
  __setSessionFetcherForTests,
  __setSessionForTests,
  type SessionFetcher,
} from "../../lib/auth/sessionStore";

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

vi.mock("../../lib/auth/authClient", () => ({
  authClient: { signUp: { email: vi.fn() } },
}));

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

  afterEach(() => {
    __resetSessionForTests();
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

  it("서버에 닿지 못하면 네트워크를 확인하라고 알린다", async () => {
    signInWithEmail.mockRejectedValue(new EmailAuthError("network"));
    render(<EmailLoginForm />);

    fill(COPY.emailField, "team@example.com");
    fill(COPY.password, "password-1234");
    fireEvent.click(screen.getByRole("button", { name: COPY.submitSignIn }));

    expect(await screen.findByText(COPY.failures.network)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: COPY.submitSignIn }),
    ).toBeEnabled();
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

  it("이 네트워크의 하루 가입 한도에 닿으면 내일 다시 가입하라고 알린다", async () => {
    signUpWithEmail.mockRejectedValue(new EmailAuthError("dailySignUpLimit"));
    render(<EmailLoginForm />);

    switchToSignUp();
    fill(COPY.name, "찬양팀");
    fill(COPY.emailField, "team@example.com");
    fill(COPY.password, "password-1234");
    fireEvent.click(screen.getByRole("button", { name: COPY.submitSignUp }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      COPY.failures.dailySignUpLimit,
    );
    expect(screen.queryByText(COPY.failures.rateLimited)).toBeNull();
  });

  it("가입은 됐는데 세션을 확인하지 못해 다시 눌러도 이미 가입한 이메일이라고 하지 않고 들어간다", async () => {
    __setSessionForTests(null);
    signUpWithEmail.mockImplementation(signUpThroughSessionStore);
    const sendSignUp = vi.mocked(authClient.signUp.email);
    sendSignUp
      .mockResolvedValueOnce({ data: {}, error: null } as never)
      .mockResolvedValue({
        data: null,
        error: {
          status: 422,
          statusText: "",
          code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
        },
      } as never);
    __setSessionFetcherForTests(
      vi
        .fn<SessionFetcher>()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValue({
          userId: "8f14e45fc1a2b3c4d5e6f",
          name: "찬양팀",
          image: null,
          expiresAt: Date.now() + 60 * 60 * 1000,
        }),
    );
    render(<EmailLoginForm />);

    switchToSignUp();
    fill(COPY.name, "찬양팀");
    fill(COPY.emailField, "team@example.com");
    fill(COPY.password, "password-1234");
    fireEvent.click(screen.getByRole("button", { name: COPY.submitSignUp }));
    expect(await screen.findByText(COPY.failures.network)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: COPY.submitSignUp }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: COPY.submitSignUp }),
      ).toBeEnabled();
    });
    expect(screen.queryByText(COPY.failures.alreadyExists)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sendSignUp).toHaveBeenCalledTimes(1);
    expect(getSessionState().status).toBe("authenticated");
  });

  it("다른 방식으로 이동하는 동안에는 제출할 수 없다", () => {
    render(<EmailLoginForm disabled />);

    expect(
      screen.getByRole("button", { name: COPY.submitSignIn }),
    ).toBeDisabled();
  });
});
