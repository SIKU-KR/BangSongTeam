import type { EmailSignUpRequest } from "#shared";
import { api } from "../api/client";
import { authClient } from "./authClient";
import { revalidateSession } from "./sessionStore";

export type EmailAuthFailure =
  | "invalid-credentials"
  | "not-allowed"
  | "already-exists"
  | "invalid-input"
  | "rate-limited"
  | "network"
  | "unknown";

/** 이메일 로그인·가입 실패. 화면 문구는 `reason`으로 고른다. */
export class EmailAuthError extends Error {
  constructor(readonly reason: EmailAuthFailure) {
    super(`이메일 인증 실패: ${reason}`);
    this.name = "EmailAuthError";
  }
}

function failureFromStatus(status: number | undefined): EmailAuthFailure {
  switch (status) {
    case undefined:
      return "network";
    case 400:
      return "invalid-input";
    case 401:
      return "invalid-credentials";
    case 403:
      return "not-allowed";
    case 422:
      return "already-exists";
    case 429:
      return "rate-limited";
    default:
      return "unknown";
  }
}

/** Better Auth 비밀번호 로그인. 성공하면 세션 스토어를 서버 세션으로 갱신한다. */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<void> {
  const result = await authClient.signIn.email({ email, password });
  if (result.error) {
    throw new EmailAuthError(failureFromStatus(result.error.status));
  }
  await revalidateSession();
}

/**
 * 허용 목록을 거치는 가입 경로(`/api/email-signup`)로 가입한다. Better Auth 공개
 * 가입 경로는 서버에서 닫혀 있다. 가입이 성공하면 곧바로 로그인된 상태가 된다.
 */
export async function signUpWithEmail(
  input: EmailSignUpRequest,
): Promise<void> {
  let status: number;
  try {
    const response = await api.api["email-signup"].$post({ json: input });
    status = response.status;
  } catch {
    throw new EmailAuthError("network");
  }

  if (status >= 400) throw new EmailAuthError(failureFromStatus(status));
  await revalidateSession();
}
