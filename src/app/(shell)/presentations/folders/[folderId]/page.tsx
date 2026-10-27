import type { Metadata } from "next";
import { COMMON_COPY } from "../../../../../client/copy/common";
import { PresentationsRoute } from "../../../../../client/routes/PresentationsRoute";
import { OFFLINE_SHELL_PARAM } from "../../../../../shared/constants/projection";

export const metadata: Metadata = { title: COMMON_COPY.myDrive };

/** 서비스 워커가 프리캐시할 오프라인 셸 (`scripts/buildServiceWorker.mjs`) */
export function generateStaticParams(): { folderId: string }[] {
  return [{ folderId: OFFLINE_SHELL_PARAM }];
}

export default function Page(): React.JSX.Element {
  return <PresentationsRoute />;
}
