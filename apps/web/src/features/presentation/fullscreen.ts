/**
 * Chrome 공식 Fullscreen API 유틸리티
 *
 * - Fullscreen API: `element.requestFullscreen({ navigationUI: 'hide' })`
 * - 보조 모니터 감지와 청중 창 배치는 `audienceWindow.ts`가 맡는다. 여기 있던
 *   `checkScreenDetails()`는 권한이 이미 granted일 때만 화면을 읽어 호출부가
 *   없는 죽은 코드였고, M4에서 `openAudienceWindow()`로 대체했다.
 */

export interface ChromeFullscreenOptions extends FullscreenOptions {
  navigationUI?: "auto" | "hide" | "show";
  screen?: unknown;
}

/**
 * Chrome 공식 Fullscreen API를 활용하여 전체화면을 요청합니다.
 * - navigationUI: 'hide' 옵션을 전달하여 주소창 및 브라우저 컨트롤을 숨깁니다.
 * - Chrome Window Management API(다중 디스플레이)가 확인된 경우 보조 화면(프로젝터 등)을 타겟팅합니다.
 * - 브라우저의 사용자 제스처(User Activation) 유효성을 보장하기 위해 requestFullscreen을 동기적으로 즉시 호출합니다.
 */
export function enterFullscreen(
  element: Element = typeof document !== "undefined"
    ? document.documentElement
    : ({} as Element),
  options?: ChromeFullscreenOptions,
): Promise<boolean> {
  if (typeof document === "undefined") {
    return Promise.resolve(false);
  }

  if (document.fullscreenElement) {
    return Promise.resolve(true);
  }

  try {
    const fullscreenOptions: ChromeFullscreenOptions = {
      navigationUI: "hide",
      ...options,
    };

    if (element.requestFullscreen) {
      return Promise.resolve(element.requestFullscreen(fullscreenOptions))
        .then(() => true)
        .catch((error) => {
          // screen 옵션으로 실패했을 경우 기본 navigationUI: 'hide'로 재시도
          if (fullscreenOptions.screen) {
            return Promise.resolve(
              element.requestFullscreen({ navigationUI: "hide" }),
            )
              .then(() => true)
              .catch((fallbackError) => {
                console.warn("Fullscreen fallback failed:", fallbackError);
                return false;
              });
          }
          console.warn(
            "Fullscreen request was not permitted or blocked:",
            error,
          );
          return false;
        });
    }
  } catch (error) {
    console.warn("Fullscreen synchronous error:", error);
  }

  return Promise.resolve(false);
}

/**
 * 전체화면을 안전하게 종료합니다.
 */
export function exitFullscreen(): Promise<boolean> {
  if (typeof document === "undefined" || !document.fullscreenElement) {
    return Promise.resolve(true);
  }

  try {
    if (document.exitFullscreen) {
      return Promise.resolve(document.exitFullscreen())
        .then(() => true)
        .catch((error) => {
          console.warn("Exit fullscreen failed:", error);
          return false;
        });
    }
  } catch (error) {
    console.warn("Exit fullscreen synchronous error:", error);
  }

  return Promise.resolve(false);
}

/**
 * 발표(프레젠테이션) 진입 함수
 * 사용자 클릭(User Activation) 시점에 즉시 Chrome Fullscreen API를 동기적으로 호출하여
 * 전체화면 상태를 활성화한 뒤 해당 프레젠테이션의 송출 경로로 즉시 이동합니다.
 *
 * 경로 조립을 이 함수 안에 두어 호출자가 경로 문자열을 직접 쓰지 않게 한다
 * (송출 대상이 활성 문서와 어긋나는 사고를 구조적으로 방지).
 */
export function launchPresentation(
  navigate: (to: string) => void,
  presentationId: string,
  options?: ChromeFullscreenOptions,
): void {
  // 사용자 제스처 컨텍스트에서 전체화면 즉시 요청.
  // 이 호출 앞에 await를 끼워 넣으면 User Activation이 소실되어 Chrome이 거부한다.
  enterFullscreen(
    typeof document !== "undefined" ? document.documentElement : undefined,
    options,
  ).catch(() => {});

  // 라우트 전환
  navigate(`/present/${presentationId}/fullscreen`);
}

/**
 * 예배 준비 화면으로 보낸다 (송출 진입의 권장 관문).
 *
 * 대시보드·편집기의 '송출' 버튼은 곧바로 전체화면으로 들어가지 않고 여기를
 * 거친다. 배경 영상을 미리 받아 두지 않으면 예배당 네트워크가 끊기는 순간
 * 배경이 검게 나오기 때문이다. 준비가 끝나지 않아도 그 화면에서 바로 송출할 수
 * 있으므로 관문이 막다른 길이 되지는 않는다.
 *
 * 전체화면을 여기서 요청하지 않는 이유: 준비 화면은 전체화면이 아니고,
 * Chrome은 사용자 제스처 없이 전체화면을 허용하지 않는다. 전체화면 진입은
 * 준비 화면의 송출 버튼 클릭에서 일어난다.
 */
export function launchPreparation(
  navigate: (to: string) => void,
  presentationId: string,
): void {
  navigate(`/present/${presentationId}/ready`);
}
