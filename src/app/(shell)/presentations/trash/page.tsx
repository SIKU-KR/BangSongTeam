import type { Metadata } from "next";
import { COMMON_COPY } from "../../../../client/copy/common";
import { TrashRoute } from "../../../../client/routes/TrashRoute";

export const metadata: Metadata = { title: COMMON_COPY.trash };

export default function Page(): React.JSX.Element {
  return <TrashRoute />;
}
