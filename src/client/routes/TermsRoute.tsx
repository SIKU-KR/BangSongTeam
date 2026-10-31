"use client";

import React from "react";
import { LegalBody, LegalDocument } from "#components/layout/LegalDocument";
import { LEGAL_COPY, LEGAL_EFFECTIVE_DATE } from "#copy/auth";
import { TERMS_DOCUMENT } from "#copy/legal";

/** 이용약관. 본문은 `TERMS_DOCUMENT`에 있다. */
export function TermsRoute(): React.JSX.Element {
  return (
    <LegalDocument
      title={LEGAL_COPY.terms}
      effectiveDate={LEGAL_EFFECTIVE_DATE}
    >
      <LegalBody document={TERMS_DOCUMENT} />
    </LegalDocument>
  );
}
