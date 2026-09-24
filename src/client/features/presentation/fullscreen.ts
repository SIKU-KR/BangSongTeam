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

/**
 * 이 호출 앞에 await를 끼워 넣으면 User Activation이 소실되어 Chrome이 전체화면 요청을 거부한다.
 * 경로 조립을 이 함수 안에 두어 호출자가 경로 문자열을 직접 쓰지 않게 한다
 * (송출 대상이 활성 문서와 어긋나는 사고를 구조적으로 방지).
 */
export function launchPresentation(
  navigate: (to: string) => void,
  presentationId: string,
  options?: ChromeFullscreenOptions,
): void {
  enterFullscreen(
    typeof document !== "undefined" ? document.documentElement : undefined,
    options,
  ).catch(() => {});

  navigate(`/present/${presentationId}/fullscreen`);
}
