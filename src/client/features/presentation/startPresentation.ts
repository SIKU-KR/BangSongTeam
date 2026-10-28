import { getMissingPresentationCapabilities } from "../../lib/browser/capabilities";
import { flushBeforeProjection } from "../../lib/sync/syncScheduler";
import { PRESENTATION_COPY } from "#copy/presentation";
import { launchPresentation, type PresentNavigate } from "./fullscreen";

/**
 * 전체화면 송출을 시작한다. 드라이브·편집기·공유 링크 보기가 모두 이 함수로 시작한다.
 *
 * 전체화면이나 배경 영상(H.264)이 안 되는 브라우저(앱 안 브라우저 등)면 빠진 기능만 들어
 * 먼저 묻고, 그만두면 false를 돌려준다. 프로젝터 화면에서야 문제를 알게 되지 않게 하려는
 * 것이다.
 *
 * 송출 화면으로 가기 전에 프레젠테이션 큐에 남은 변경을 보낸다(`flushBeforeProjection`). 송출하는
 * 동안 큐는 보내지 않는다.
 *
 * 클릭·키 입력 핸들러 안에서 동기로 불러야 브라우저가 전체화면을 허용한다. 이 함수와 호출
 * 경로 사이에 await를 끼우지 않는다. 전체화면 요청 앞에 띄우는 창도 열려 있는 동안 클릭의
 * 사용자 활성화 시간(Chrome 5초)을 쓰므로, 곧바로 답할 수 있게 짧게 둔다.
 */
export function startPresentation(
  navigate: PresentNavigate,
  presentationId: string,
  returnTo: string,
): boolean {
  const missing = getMissingPresentationCapabilities();
  if (
    missing.length > 0 &&
    !window.confirm(
      PRESENTATION_COPY.presentUnreliable(
        missing.map(({ label }) => label).join(", "),
      ),
    )
  ) {
    return false;
  }
  flushBeforeProjection();
  launchPresentation(navigate, presentationId, returnTo);
  return true;
}
