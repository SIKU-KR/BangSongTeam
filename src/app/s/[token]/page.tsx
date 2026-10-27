import type { Metadata } from "next";
import { SHELL_COPY } from "../../../client/copy/shell";
import { ShareRoute } from "../../../client/routes/ShareRoute";
import { OFFLINE_SHELL_PARAM } from "../../../shared/constants/projection";

export const metadata: Metadata = { title: SHELL_COPY.pageTitle.share };

/** 서비스 워커가 프리캐시할 오프라인 셸 (`scripts/buildServiceWorker.mjs`) */
export function generateStaticParams(): { token: string }[] {
  return [{ token: OFFLINE_SHELL_PARAM }];
}

export default function Page(): React.JSX.Element {
  return <ShareRoute />;
}
