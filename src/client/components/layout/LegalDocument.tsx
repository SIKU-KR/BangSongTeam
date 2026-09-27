import React from "react";
import { Link } from "react-router-dom";
import { Button } from "#components/ui/button";

/**
 * 운영 브랜드. 법인도 개인사업자도 아니라 계약 주체가 될 수 없으므로,
 * 약관·처리방침에서는 늘 {@link OPERATOR_NAME}과 함께 적는다.
 */
export const OPERATOR_BRAND = "시쿠랩스";

/** 운영자이자 개인정보 보호책임자. 권리 행사·게시 중단 요청을 받는 창구다. */
export const OPERATOR_NAME = "박범식";
export const OPERATOR_EMAIL = "peter012677@naver.com";

/** 이용약관·개인정보 처리방침처럼 로그인 없이도 여는 긴 글 화면의 틀 */
export function LegalDocument({
  title,
  effectiveDate,
  children,
}: {
  title: string;
  effectiveDate: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <article className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 text-sm/relaxed">
        <header className="flex flex-col gap-2">
          <Button
            variant="link"
            size="xs"
            nativeButton={false}
            render={<Link to="/" />}
            className="self-start"
          >
            방송팀 다모여
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">시행일: {effectiveDate}</p>
        </header>
        {children}
      </article>
    </div>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function LegalList({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return <ul className="list-disc space-y-1 pl-5">{children}</ul>;
}
