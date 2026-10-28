import type { Metadata } from "next";
import { LEGAL_COPY } from "../../client/copy/auth";
import { TermsRoute } from "../../client/routes/TermsRoute";

export const metadata: Metadata = { title: LEGAL_COPY.terms };

export default function Page(): React.JSX.Element {
  return <TermsRoute />;
}
