export interface ChromeFullscreenOptions extends FullscreenOptions {
  navigationUI?: "auto" | "hide" | "show";
}

/**
 * 브라우저의 User Activation 유효성을 보장하기 위해 requestFullscreen을 동기적으로 즉시 호출한다.
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

/** 송출 종료 후 돌아갈 곳을 모를 때(주소 직접 진입·새로고침)의 복귀 경로 */
export const DEFAULT_PRESENT_RETURN_PATH = "/presentations";

/** 송출 라우트로 넘기는 history state. 송출을 시작한 화면의 경로를 담는다. */
export interface PresentLaunchState {
  returnTo: string;
}

export type PresentNavigate = (
  to: string,
  options: { state: PresentLaunchState },
) => void;

/**
 * 이 호출 앞에 await를 끼워 넣으면 User Activation이 소실되어 Chrome이 전체화면 요청을 거부한다.
 * 경로 조립을 이 함수 안에 두어 호출자가 경로 문자열을 직접 쓰지 않게 한다
 * (송출 대상이 활성 문서와 어긋나는 사고를 구조적으로 방지).
 *
 * `returnTo`는 송출 종료 시 돌아갈 출발 화면 경로다 (편집기에서 시작하면 편집기, 드라이브에서 시작하면 드라이브).
 */
export function launchPresentation(
  navigate: PresentNavigate,
  presentationId: string,
  returnTo: string,
  options?: ChromeFullscreenOptions,
): void {
  enterFullscreen(
    typeof document !== "undefined" ? document.documentElement : undefined,
    options,
  ).catch(() => {});

  navigate(`/present/${presentationId}/fullscreen`, { state: { returnTo } });
}

/**
 * 송출 라우트의 history state에서 복귀 경로를 꺼낸다.
 * 앱 내부 경로(`/`로 시작하고 `//`가 아닌 것)만 받아 외부 주소로 튕겨 나가지 않게 한다.
 */
export function resolvePresentReturnPath(state: unknown): string {
  if (typeof state !== "object" || state === null) {
    return DEFAULT_PRESENT_RETURN_PATH;
  }
  const returnTo = (state as Partial<PresentLaunchState>).returnTo;
  if (
    typeof returnTo !== "string" ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//")
  ) {
    return DEFAULT_PRESENT_RETURN_PATH;
  }
  return returnTo;
}
