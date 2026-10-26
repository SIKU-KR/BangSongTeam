import { FullscreenPresentRoute } from "../../../../client/routes/FullscreenPresentRoute";
import { OFFLINE_SHELL_PARAM } from "../../../../shared/constants/projection";

/** 서비스 워커가 프리캐시할 오프라인 셸 (`scripts/buildServiceWorker.mjs`) */
export function generateStaticParams(): { presentationId: string }[] {
  return [{ presentationId: OFFLINE_SHELL_PARAM }];
}

export default function Page(): React.JSX.Element {
  return <FullscreenPresentRoute />;
}
