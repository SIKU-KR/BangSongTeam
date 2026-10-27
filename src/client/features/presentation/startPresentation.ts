import { canPresentReliably } from "../../lib/browser/capabilities";
import { flushBeforeProjection } from "../../lib/sync/syncScheduler";
import { PRESENTATION_COPY } from "#copy/presentation";
import { launchPresentation, type PresentNavigate } from "./fullscreen";

/**
 * 전체화면 송출을 시작한다. 드라이브·편집기·공유 링크 보기가 모두 이 함수로 시작한다.
 *
 * 전체화면·배경 영상 재생·화면 꺼짐 방지 중 하나라도 없는 브라우저(앱 안 브라우저 등)면
 * 먼저 묻고, 그만두면 false를 돌려준다. 프로젝터 화면에서야 문제를 알게 되지 않게 하려는
 * 것이다.
 *
 * 송출 화면으로 가기 전에 프레젠테이션 큐에 남은 변경을 보낸다(`flushBeforeProjection`). 송출하는
 * 동안 큐는 보내지 않는다.
 *
 * 클릭·키 입력 핸들러 안에서 동기로 불러야 브라우저가 전체화면을 허용한다. 이 함수와 호출
 * 경로 사이에 await를 끼우지 않는다.
 */
export function startPresentation(
  navigate: PresentNavigate,
  presentationId: string,
  returnTo: string,
): boolean {
  if (
    !canPresentReliably() &&
    !window.confirm(PRESENTATION_COPY.presentUnreliable)
  ) {
    return false;
  }
  flushBeforeProjection();
  launchPresentation(navigate, presentationId, returnTo);
  return true;
}
