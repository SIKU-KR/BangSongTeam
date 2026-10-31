"use client";

import React from "react";
import { LegalBody, LegalDocument } from "#components/layout/LegalDocument";
import { LEGAL_COPY, LEGAL_EFFECTIVE_DATE } from "#copy/auth";
import { PRIVACY_DOCUMENT } from "#copy/legal";

/** 개인정보 처리방침. 본문과 수집 항목의 근거는 `PRIVACY_DOCUMENT`에 있다. */
export function PrivacyRoute(): React.JSX.Element {
  return (
    <LegalDocument
      title={LEGAL_COPY.privacy}
      effectiveDate={LEGAL_EFFECTIVE_DATE}
    >
      <LegalBody document={PRIVACY_DOCUMENT} />
    </LegalDocument>
  );
}
