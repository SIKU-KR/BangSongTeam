import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrivacyRoute } from "./PrivacyRoute";
import { TermsRoute } from "./TermsRoute";
import { LEGAL_COPY, LEGAL_EFFECTIVE_DATE } from "#copy/auth";

function sectionText(heading: string): string {
  const section = screen
    .getByRole("heading", { name: heading })
    .closest("section");
  return section?.textContent ?? "";
}

describe("개인정보 처리방침", () => {
  it("이메일로 가입할 때 입력하는 정보와 비밀번호를 암호화해 저장한다는 것을 처리 항목에 적는다", () => {
    render(<PrivacyRoute />);

    const items = sectionText("1. 처리하는 개인정보 항목과 수집 방법");
    expect(items).toMatch(/이메일로 가입/);
    expect(items).toMatch(/비밀번호\(복원할 수 없도록 일방향 암호화해 저장\)/);
    expect(items).toMatch(/카카오·네이버·Google 로그인/);
  });

  it("요청을 전달하고 배경 미디어를 캐시하는 Cloudflare를 국외 이전받는 자로 적는다", () => {
    render(<PrivacyRoute />);

    const transfer = sectionText("5. 제3자 제공과 국외 이전");
    expect(transfer).toMatch(/Google LLC/);
    expect(transfer).toMatch(/Cloudflare, Inc\./);
    expect(transfer).toMatch(/배경 미디어 캐시/);
  });

  it("바뀐 시행일을 보이고 세트라는 말을 쓰지 않는다", () => {
    render(<PrivacyRoute />);

    expect(
      screen.getByText(LEGAL_COPY.effectiveDate(LEGAL_EFFECTIVE_DATE)),
    ).toBeInTheDocument();
    expect(LEGAL_COPY.effectiveDate(LEGAL_EFFECTIVE_DATE)).toBe(
      "시행일: 2026년 11월 3일",
    );
    expect(document.body.textContent).not.toMatch(/세트/);
  });
});

describe("이용약관", () => {
  it("이메일로도 가입할 수 있다고 적는다", () => {
    render(<TermsRoute />);

    expect(sectionText("제3조 (계정)")).toMatch(/이메일로 계정을 만든/);
  });

  it("바뀐 시행일을 보이고 세트라는 말을 쓰지 않는다", () => {
    render(<TermsRoute />);

    expect(screen.getByText("시행일: 2026년 11월 3일")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/세트/);
  });
});
