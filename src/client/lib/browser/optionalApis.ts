type OptionalNavigatorApi = "clipboard" | "serviceWorker" | "storage";

/**
 * 브라우저에 따라 없을 수 있는 navigator API.
 *
 * DOM 타입은 이 API들이 늘 있다고 보지만 비보안 컨텍스트(HTTP)나 구형 브라우저에는 없다.
 * 반환 타입에 `undefined`를 드러내 쓰는 쪽이 있는지 먼저 확인하게 한다.
 */
export function navigatorApi<K extends OptionalNavigatorApi>(
  name: K,
): Navigator[K] | undefined {
  return typeof navigator === "undefined" ? undefined : navigator[name];
}

/** 브라우저에 따라 없을 수 있는 CSS Font Loading API(`document.fonts`) */
export function documentFonts(): FontFaceSet | undefined {
  return typeof document === "undefined" ? undefined : document.fonts;
}
