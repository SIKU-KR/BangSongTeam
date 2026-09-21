/**
 * Chrome 공식 Fullscreen API 및 Window Management API 유틸리티
 *
 * - Fullscreen API: `element.requestFullscreen({ navigationUI: 'hide' })`
 * - Window Management API: 다중 디스플레이(보조 모니터/프로젝터) 감지 및 타겟 송출
 */

export interface ChromeFullscreenOptions extends FullscreenOptions {
  navigationUI?: "auto" | "hide" | "show";
  screen?: unknown;
}

let cachedSecondaryScreen: unknown = null;

/**
 * Window Management API (Chrome 100+)를 사전 조회하여
 * 보조 모니터(프로젝터 등)가 연결되어 있는지 캐시합니다.
 * (클릭 이벤트 발생 시 비동기 지연 없이 동기적으로 화면을 지정할 수 있도록 함)
 */
export async function checkScreenDetails(): Promise<unknown> {
  if (typeof window === "undefined" || !("getScreenDetails" in window)) {
    return null;
  }

  try {
    const permission = await navigator.permissions?.query?.({
      name: "window-management" as PermissionName,
    });
    if (permission?.state === "granted") {
      const screenDetails = await (
        window as unknown as {
          getScreenDetails: () => Promise<{
            screens: unknown[];
            currentScreen: unknown;
          }>;
        }
      ).getScreenDetails();
      const secondary = screenDetails?.screens?.find(
        (s) => s !== screenDetails.currentScreen,
      );
      cachedSecondaryScreen = secondary ?? null;
      return cachedSecondaryScreen;
    }
  } catch {
    // 권한 거부 또는 미지원 시 무시
  }
  return null;
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
      ...(cachedSecondaryScreen ? { screen: cachedSecondaryScreen } : {}),
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
