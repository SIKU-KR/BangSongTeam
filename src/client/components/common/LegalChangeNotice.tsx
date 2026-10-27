import React, { useState } from "react";
import { InfoIcon } from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "#components/ui/alert";
import { Button } from "#components/ui/button";
import { COMMON_COPY } from "#copy/common";
import { LEGAL_COPY, LEGAL_EFFECTIVE_DATE } from "#copy/auth";

const DISMISS_KEY = `dismiss_legal_change:${LEGAL_EFFECTIVE_DATE}`;
const EFFECTIVE_AT = Date.parse(`${LEGAL_EFFECTIVE_DATE}T00:00:00+09:00`);

const LINKS = [
  { href: "/terms", label: LEGAL_COPY.terms },
  { href: "/privacy", label: LEGAL_COPY.privacy },
];

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * 이용약관·개인정보 처리방침이 바뀐다는 안내 배너.
 *
 * 두 글은 바꾸면 시행 7일 전부터 서비스 화면에 알린다고 정해 두어(처리방침 11항, 약관 제9조),
 * 시행일(`LEGAL_EFFECTIVE_DATE`, 한국 시각 0시) 전까지만 띄운다. 닫으면 그 시행일의 안내는
 * 브라우저에 기억해 다시 띄우지 않는다. 브라우저 저장소를 쓸 수 없으면 기억하지 못할 뿐 닫을
 * 수는 있다.
 */
export function LegalChangeNotice(): React.JSX.Element | null {
  const [hidden, setHidden] = useState(
    () => Date.now() >= EFFECTIVE_AT || isDismissed(),
  );

  if (hidden) return null;

  const handleDismiss = (): void => {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch (error) {
      void error;
    }
    setHidden(true);
  };

  return (
    <Alert
      role="status"
      data-testid="legal-change-notice"
      className="shrink-0 rounded-none border-x-0 border-t-0"
    >
      <InfoIcon />
      <AlertTitle>{LEGAL_COPY.change.title(LEGAL_EFFECTIVE_DATE)}</AlertTitle>
      <AlertDescription>
        {LEGAL_COPY.change.description}
        <div className="mt-1 flex gap-3">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label}
            </a>
          ))}
        </div>
      </AlertDescription>
      <AlertAction>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDismiss}
          aria-label={LEGAL_COPY.change.dismiss}
        >
          {COMMON_COPY.close}
        </Button>
      </AlertAction>
    </Alert>
  );
}
