import type { Metadata } from "next";
import { COMMON_COPY } from "../../../client/copy/common";
import { PresentationsRoute } from "../../../client/routes/PresentationsRoute";

export const metadata: Metadata = { title: COMMON_COPY.myDrive };

export default function Page(): React.JSX.Element {
  return <PresentationsRoute />;
}
