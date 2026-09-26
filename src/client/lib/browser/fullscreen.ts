/**
 * 브라우저마다 다른 Fullscreen API를 한 인터페이스로 감싼 전략.
 *
 * 진입·종료·현재 요소·변경 이벤트 이름이 환경에 따라 함께 바뀌므로 하나의 객체로 묶는다.
 * 호출부는 `resolveFullscreenStrategy()`가 고른 전략만 쓰고 접두사 분기를 직접 하지 않는다.
 */
export interface FullscreenStrategy {
  readonly kind: "standard" | "webkit" | "unsupported";
  /** 전체화면 변경을 알리는 이벤트 이름. 전체화면을 쓸 수 없으면 null */
  readonly changeEvent: string | null;
  element(doc: Document): Element | null;
  request(element: Element, options?: FullscreenOptions): Promise<void>;
  exit(doc: Document): Promise<void>;
}

interface WebkitFullscreenDocument {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebkitFullscreenElement {
  webkitRequestFullscreen?: (
    options?: FullscreenOptions,
  ) => Promise<void> | void;
}

function unavailable(): Promise<void> {
  return Promise.reject(new Error("Fullscreen API is not available"));
}

const standardStrategy: FullscreenStrategy = {
  kind: "standard",
  changeEvent: "fullscreenchange",
  element: (doc) => doc.fullscreenElement ?? null,
  request: (element, options) =>
    typeof element.requestFullscreen === "function"
      ? element.requestFullscreen(options)
      : unavailable(),
  exit: (doc) =>
    typeof doc.exitFullscreen === "function"
      ? doc.exitFullscreen()
      : unavailable(),
};

/** Safari 16.4 미만은 접두사 API만 있고, 반환값이 Promise가 아닐 수 있다 */
const webkitStrategy: FullscreenStrategy = {
  kind: "webkit",
  changeEvent: "webkitfullscreenchange",
  element: (doc) =>
    (doc as unknown as WebkitFullscreenDocument).webkitFullscreenElement ??
    null,
  request: (element, options) => {
    const request = (element as unknown as WebkitFullscreenElement)
      .webkitRequestFullscreen;
    return request
      ? Promise.resolve(request.call(element, options))
      : unavailable();
  },
  exit: (doc) => {
    const exit = (doc as unknown as WebkitFullscreenDocument)
      .webkitExitFullscreen;
    return exit ? Promise.resolve(exit.call(doc)) : unavailable();
  },
};

const unsupportedStrategy: FullscreenStrategy = {
  kind: "unsupported",
  changeEvent: null,
  element: () => null,
  request: unavailable,
  exit: unavailable,
};

/**
 * 지금 문서에 맞는 전체화면 전략을 고른다.
 * 호출할 때마다 다시 고른다. 확인 비용이 거의 없고, 모듈 로드 시점에 캐시하면
 * 뒤늦게 붙는 API(테스트 목 포함)를 놓친다.
 */
export function resolveFullscreenStrategy(
  doc: Document | undefined = typeof document === "undefined"
    ? undefined
    : document,
): FullscreenStrategy {
  if (!doc) return unsupportedStrategy;
  const root = doc.documentElement;
  if (
    "fullscreenElement" in doc ||
    typeof root.requestFullscreen === "function"
  ) {
    return standardStrategy;
  }
  if (
    typeof (root as unknown as WebkitFullscreenElement)
      .webkitRequestFullscreen === "function"
  ) {
    return webkitStrategy;
  }
  return unsupportedStrategy;
}
