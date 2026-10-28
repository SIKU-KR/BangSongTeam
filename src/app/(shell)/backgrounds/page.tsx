import type { Metadata } from "next";
import { SHELL_COPY } from "../../../client/copy/shell";
import { BackgroundsRoute } from "../../../client/routes/BackgroundsRoute";

export const metadata: Metadata = { title: SHELL_COPY.backgroundGallery };

export default function Page(): React.JSX.Element {
  return <BackgroundsRoute />;
}
