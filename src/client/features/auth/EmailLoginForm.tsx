import React, { useId, useState } from "react";
import { Button } from "#components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "#components/ui/field";
import { Input } from "#components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "#components/ui/toggle-group";
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

/** 이메일·비밀번호 로그인과 허용 목록 가입 폼 */
export function EmailLoginForm(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === "sign-up";
  const fieldId = useId();

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
      <FieldGroup>
        <ToggleGroup
          aria-label="이메일 로그인 방식"
          variant="outline"
          value={[mode]}
          onValueChange={(value) => {
            const next = value[0] as Mode | undefined;
            if (next) switchMode(next);
          }}
          className="w-full"
        >
          <ToggleGroupItem value="sign-in" className="flex-1">
            로그인
          </ToggleGroupItem>
          <ToggleGroupItem value="sign-up" className="flex-1">
            가입
          </ToggleGroupItem>
        </ToggleGroup>

        {isSignUp && (
          <Field>
            <FieldLabel htmlFor={`${fieldId}-name`}>이름</FieldLabel>
            <Input
              id={`${fieldId}-name`}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              maxLength={50}
            />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor={`${fieldId}-email`}>이메일</FieldLabel>
          <Input
            id={`${fieldId}-email`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          {isSignUp && (
            <FieldDescription>
              허용된 이메일만 가입할 수 있습니다.
            </FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${fieldId}-password`}>비밀번호</FieldLabel>
          <Input
            id={`${fieldId}-password`}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            maxLength={PASSWORD_MAX_LENGTH}
          />
          {isSignUp && (
            <FieldDescription>
              {PASSWORD_MIN_LENGTH}자 이상 입력해 주세요.
            </FieldDescription>
          )}
        </Field>

        {error && <FieldError>{error}</FieldError>}

        <Button type="submit" size="lg" disabled={pending}>
          {isSignUp
            ? pending
              ? "가입 중…"
              : "가입하기"
            : pending
              ? "로그인 중…"
              : "이메일로 로그인"}
        </Button>
      </FieldGroup>
    </form>
  );
}

function failureMessage(err: unknown): string {
  return FAILURE_MESSAGES[
    err instanceof EmailAuthError ? err.reason : "unknown"
  ];
}

export default EmailLoginForm;
