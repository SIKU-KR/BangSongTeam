import React, { useId, useState } from "react";
import { useMatch } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#components/ui/alert-dialog";
import { Button } from "#components/ui/button";
import { Checkbox } from "#components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "#components/ui/field";
import { signOut, useSession } from "../../lib/auth";
import {
  useAgreeConsent,
  useConsentStatus,
} from "../../lib/api/consentQueries";
import { describeApiError } from "../../lib/api/request";

type ConsentItem = "ageOver14" | "terms" | "privacy";

const ITEMS: { id: ConsentItem; label: string; href?: string }[] = [
  { id: "ageOver14", label: "[필수] 만 14세 이상입니다" },
  { id: "terms", label: "[필수] 이용약관 동의", href: "/terms" },
  {
    id: "privacy",
    label: "[필수] 개인정보 수집·이용 동의",
    href: "/privacy",
  },
];

const NONE_CHECKED: Record<ConsentItem, boolean> = {
  ageOver14: false,
  terms: false,
  privacy: false,
};

/**
 * 가입 동의를 마치지 않은 로그인 사용자에게 닫을 수 없는 동의 모달을 띄운다.
 *
 * 소셜 로그인은 첫 로그인에 계정이 만들어지므로 가입 절차를 이 모달이 대신한다.
 * 동의 상태를 확인하지 못하면(오프라인 등) 막지 않는다. 예배 중 네트워크가 끊겨도
 * 이미 쓰던 사용자가 갇히면 안 된다. 송출 화면은 요청 0건 규칙 때문에, 약관
 * 페이지는 모달의 '보기'로 여는 곳이라 건너뛴다.
 */
export function ConsentGate(): React.JSX.Element | null {
  const isFullscreen = useMatch("/present/:presentationId/fullscreen");
  const isTerms = useMatch("/terms");
  const isPrivacy = useMatch("/privacy");
  const session = useSession();

  if (isFullscreen || isTerms || isPrivacy || !session.user) return null;
  return <ConsentCheck userId={session.user.userId} />;
}

function ConsentCheck({
  userId,
}: {
  userId: string;
}): React.JSX.Element | null {
  const { data } = useConsentStatus(userId);
  if (!data || data.agreedAt !== null) return null;
  return <ConsentDialog userId={userId} />;
}

function ConsentDialog({ userId }: { userId: string }): React.JSX.Element {
  const [checked, setChecked] = useState(NONE_CHECKED);
  const agree = useAgreeConsent(userId);
  const idPrefix = useId();
  const allChecked = ITEMS.every((item) => checked[item.id]);

  const setAll = (value: boolean): void => {
    setChecked({ ageOver14: value, terms: value, privacy: value });
  };

  return (
    <AlertDialog open>
      <AlertDialogContent data-testid="consent-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>교회 방송팀 다모여! 이용 동의</AlertDialogTitle>
          <AlertDialogDescription>
            서비스를 시작하려면 아래 필수 항목에 동의해 주세요.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <FieldGroup>
          <Field orientation="horizontal">
            <Checkbox
              id={`${idPrefix}-all`}
              data-testid="consent-all"
              checked={allChecked}
              onCheckedChange={(value) => setAll(value)}
            />
            <FieldLabel htmlFor={`${idPrefix}-all`}>전체 동의</FieldLabel>
          </Field>
          <FieldSeparator />
          {ITEMS.map((item) => (
            <Field key={item.id} orientation="horizontal">
              <Checkbox
                id={`${idPrefix}-${item.id}`}
                data-testid={`consent-${item.id}`}
                checked={checked[item.id]}
                onCheckedChange={(value) =>
                  setChecked((prev) => ({ ...prev, [item.id]: value }))
                }
              />
              <FieldLabel htmlFor={`${idPrefix}-${item.id}`}>
                {item.label}
              </FieldLabel>
              {item.href && (
                <Button
                  variant="link"
                  size="xs"
                  nativeButton={false}
                  render={
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  보기
                </Button>
              )}
            </Field>
          ))}
        </FieldGroup>

        {agree.error && (
          <FieldError>{describeApiError(agree.error)}</FieldError>
        )}

        <AlertDialogFooter>
          <AlertDialogAction
            variant="outline"
            data-testid="consent-decline"
            disabled={agree.isPending}
            onClick={() => void signOut()}
          >
            동의하지 않음
          </AlertDialogAction>
          <AlertDialogAction
            data-testid="consent-agree"
            disabled={!allChecked || agree.isPending}
            onClick={() =>
              agree.mutate({ ageOver14: true, terms: true, privacy: true })
            }
          >
            {agree.isPending ? "저장하는 중…" : "동의하고 시작하기"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
