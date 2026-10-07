import React, { useState } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "#components/ui/alert";
import { Button } from "#components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import {
  SOCIAL_PROVIDERS,
  signInWithProvider,
  type SocialProvider,
} from "../lib/auth";
import { SocialLoginButton } from "../features/auth/SocialLoginButton";
import { AUTH_COPY, LEGAL_COPY } from "#copy/auth";
import { APP_NAME, DEV_USERS } from "#shared";

const LEGAL_LINKS = [
  { href: "/terms", label: LEGAL_COPY.terms },
  { href: "/privacy", label: LEGAL_COPY.privacy },
];

interface LoginRouteProps {
  /** 로그인이 필요한 까닭. 없으면 계정 저장 안내를 보여 준다 */
  description?: string;
  /** 로그인하지 않고 원래 화면으로 돌아간다 */
  onCancel?: () => void;
}

/** 로그인 화면 라우트 */
export function LoginRoute({
  description = AUTH_COPY.defaultDescription,
  onCancel,
}: LoginRouteProps = {}): React.JSX.Element {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async (provider: SocialProvider): Promise<void> => {
    setPending(provider);
    setError(null);
    try {
      await signInWithProvider(provider);
    } catch {
      setError(AUTH_COPY.signInFailed);
      setPending(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{APP_NAME}</CardTitle>
          <CardDescription data-testid="login-description">
            {description}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            {SOCIAL_PROVIDERS.map((provider) => (
              <SocialLoginButton
                key={provider.id}
                provider={provider.id}
                label={provider.label}
                pending={pending === provider.id}
                disabled={pending !== null}
                onClick={() => void handleSignIn(provider.id)}
              />
            ))}
          </div>

          {import.meta.env.DEV && (
            <div data-testid="dev-sign-in" className="flex flex-col gap-2">
              <p className="text-center text-xs text-muted-foreground">
                {AUTH_COPY.dev.title}
              </p>
              {DEV_USERS.map((dev) => (
                <Button
                  key={dev.id}
                  variant="outline"
                  nativeButton={false}
                  render={<a href={`/api/auth/dev/sign-in?userId=${dev.id}`} />}
                >
                  {AUTH_COPY.dev.signInAs(dev.name)}
                  {!dev.termsAgreed && ` · ${AUTH_COPY.dev.consentPending}`}
                </Button>
              ))}
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>

        <CardFooter className="flex-col gap-2 text-xs text-muted-foreground">
          {onCancel && (
            <Button
              variant="ghost"
              data-testid="login-cancel-btn"
              disabled={pending !== null}
              onClick={onCancel}
            >
              {AUTH_COPY.cancel}
            </Button>
          )}
          {AUTH_COPY.optimizedFor}
          <div className="flex gap-1">
            {LEGAL_LINKS.map((link) => (
              <Button
                key={link.href}
                variant="link"
                size="xs"
                nativeButton={false}
                render={
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                {link.label}
              </Button>
            ))}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
