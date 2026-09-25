import React, { useState } from "react";
import {
  EmailSignUpRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "#shared";
import {
  EmailAuthError,
  signInWithEmail,
  signUpWithEmail,
  type EmailAuthFailure,
} from "../../lib/auth";

type Mode = "sign-in" | "sign-up";

const PASSWORD_RULE = `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상 ${PASSWORD_MAX_LENGTH}자 이하로 입력해 주세요.`;

const FAILURE_MESSAGES: Record<EmailAuthFailure, string> = {
  "invalid-credentials": "이메일 또는 비밀번호가 맞지 않습니다.",
  "not-allowed": "가입이 허용되지 않은 이메일입니다.",
  "already-exists": "이미 가입된 이메일입니다. 로그인해 주세요.",
  "invalid-input": `이메일 형식을 확인해 주세요. ${PASSWORD_RULE}`,
  "rate-limited": "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  network: "서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.",
  unknown: "로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

const SIGN_UP_FIELD_MESSAGES: Record<string, string> = {
  email: "이메일 형식을 확인해 주세요.",
  password: PASSWORD_RULE,
  name: "이름을 입력해 주세요.",
};

const inputClassName =
  "w-full px-3 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400";

/** 이메일·비밀번호 로그인과 허용 목록 가입 폼 */
export function EmailLoginForm(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === "sign-up";

  const switchMode = (next: Mode): void => {
    setMode(next);
    setError(null);
  };

  const prepare = (): (() => Promise<void>) | string => {
    if (!isSignUp) return () => signInWithEmail(email.trim(), password);

    const parsed = EmailSignUpRequestSchema.safeParse({
      email,
      password,
      name,
    });
    if (parsed.success) return () => signUpWithEmail(parsed.data);

    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return SIGN_UP_FIELD_MESSAGES[field] ?? FAILURE_MESSAGES["invalid-input"];
  };

  const submit = async (): Promise<void> => {
    const send = prepare();
    if (typeof send === "string") {
      setError(send);
      return;
    }

    setError(null);
    setPending(true);
    try {
      await send();
    } catch (err) {
      setError(failureMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      data-testid="email-login-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div
        role="group"
        aria-label="이메일 로그인 방식"
        className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800"
      >
        {(
          [
            ["sign-in", "로그인"],
            ["sign-up", "가입"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => switchMode(value)}
            className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
              mode === value
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {isSignUp && (
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="이름"
            aria-label="이름"
            autoComplete="name"
            maxLength={50}
            className={inputClassName}
          />
        )}
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="이메일"
          aria-label="이메일"
          autoComplete="email"
          className={inputClassName}
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={
            isSignUp ? `비밀번호 (${PASSWORD_MIN_LENGTH}자 이상)` : "비밀번호"
          }
          aria-label="비밀번호"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          maxLength={PASSWORD_MAX_LENGTH}
          className={inputClassName}
        />
      </div>

      {isSignUp && (
        <p className="mt-2 text-[11px] text-zinc-500">
          허용된 이메일만 가입할 수 있습니다.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-3 w-full rounded-xl bg-zinc-900 py-3 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {isSignUp
          ? pending
            ? "가입 중…"
            : "가입하기"
          : pending
            ? "로그인 중…"
            : "이메일로 로그인"}
      </button>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}

function failureMessage(err: unknown): string {
  return FAILURE_MESSAGES[
    err instanceof EmailAuthError ? err.reason : "unknown"
  ];
}

export default EmailLoginForm;
