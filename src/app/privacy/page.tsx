import type { Metadata } from "next";
import { LEGAL_COPY } from "../../client/copy/auth";
import { PrivacyRoute } from "../../client/routes/PrivacyRoute";

export const metadata: Metadata = { title: LEGAL_COPY.privacy };

export default function Page(): React.JSX.Element {
  return <PrivacyRoute />;
}
