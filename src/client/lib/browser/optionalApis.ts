type OptionalNavigatorApi = "clipboard" | "locks" | "serviceWorker" | "storage";

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

/**
 * 사용자가 데이터 절약 모드를 켰는지(`navigator.connection.saveData`). Network Information
 * API가 없는 브라우저(Safari·Firefox)에서는 false다. DOM 타입에 없는 API라 여기서 좁혀 읽는다.
 */
export function prefersReducedData(): boolean {
  if (typeof navigator === "undefined") return false;
  const { connection } = navigator as Navigator & {
    connection?: { saveData?: boolean };
  };
  return connection?.saveData === true;
}

/** 브라우저에 따라 없을 수 있는 CSS Font Loading API(`document.fonts`) */
export function documentFonts(): FontFaceSet | undefined {
  return typeof document === "undefined" ? undefined : document.fonts;
}
