import React, { useState } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "#components/ui/alert";
import { Button } from "#components/ui/button";
import { Field, FieldDescription, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { AUTH_COPY } from "#copy/auth";
import {
  EmailSignUpRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USER_NAME_MAX_LENGTH,
} from "#shared";
import {
  EmailAuthError,
  signInWithEmail,
  signUpWithEmail,
} from "../../lib/auth";

type Mode = "sign-in" | "sign-up";

const COPY = AUTH_COPY.email;

const FIELD_MESSAGES: Record<string, string> = {
  name: COPY.invalidName,
  email: COPY.invalidEmail,
  password: COPY.invalidPassword(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH),
};

function failureMessage(error: unknown): string {
  return COPY.failures[
    error instanceof EmailAuthError ? error.reason : "unknown"
  ];
}

interface EmailLoginFormProps {
  /** 소셜 로그인 등 다른 방식으로 이동하는 중이면 입력을 막는다 */
  disabled?: boolean;
}

/** 이메일·비밀번호 로그인과 가입 폼. 가입하면 바로 로그인된다. */
export function EmailLoginForm({
  disabled = false,
}: EmailLoginFormProps = {}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === "sign-up";

  const switchMode = (next: Mode): void => {
    setMode(next);
    setError(null);
  };

  const submit = async (): Promise<void> => {
    let send: () => Promise<void>;
    if (isSignUp) {
      const parsed = EmailSignUpRequestSchema.safeParse({
        name,
        email: email.trim(),
        password,
      });
      if (!parsed.success) {
        const field = String(parsed.error.issues[0]?.path[0] ?? "");
        setError(FIELD_MESSAGES[field] ?? COPY.failures.invalidInput);
        return;
      }
      send = () => signUpWithEmail(parsed.data);
    } else {
      send = () => signInWithEmail(email.trim(), password);
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

  const blocked = pending || disabled;

  return (
    <form
      data-testid="email-login-form"
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div
        role="group"
        aria-label={COPY.modeLabel}
        className="grid grid-cols-2 gap-1"
      >
        <Button
          type="button"
          size="sm"
          variant={isSignUp ? "ghost" : "secondary"}
          aria-pressed={!isSignUp}
          onClick={() => switchMode("sign-in")}
        >
          {COPY.signIn}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={isSignUp ? "secondary" : "ghost"}
          aria-pressed={isSignUp}
          onClick={() => switchMode("sign-up")}
        >
          {COPY.signUp}
        </Button>
      </div>

      {isSignUp && (
        <Field>
          <FieldLabel htmlFor="email-login-name">{COPY.name}</FieldLabel>
          <Input
            id="email-login-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            maxLength={USER_NAME_MAX_LENGTH}
          />
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="email-login-email">{COPY.emailField}</FieldLabel>
        <Input
          id="email-login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="email-login-password">{COPY.password}</FieldLabel>
        <Input
          id="email-login-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={isSignUp ? "new-password" : "current-password"}
          maxLength={PASSWORD_MAX_LENGTH}
        />
        {isSignUp && (
          <FieldDescription>
            {COPY.passwordHint(PASSWORD_MIN_LENGTH)}
          </FieldDescription>
        )}
      </Field>

      {error && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={blocked}>
        {isSignUp
          ? pending
            ? COPY.pendingSignUp
            : COPY.submitSignUp
          : pending
            ? COPY.pendingSignIn
            : COPY.submitSignIn}
      </Button>
    </form>
  );
}
