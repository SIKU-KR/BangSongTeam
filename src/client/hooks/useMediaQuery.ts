import { useCallback, useSyncExternalStore } from "react";

/** Tailwind `max-sm`과 같은 경계(640px 미만) */
export const BELOW_SM_QUERY = "(width < 40rem)";

/** Tailwind `max-md`와 같은 경계(768px 미만) */
export const BELOW_MD_QUERY = "(width < 48rem)";

/**
 * CSS 미디어 쿼리가 지금 맞는지.
 *
 * 모양만 달라지면 Tailwind 변형(`md:`)으로 충분하고, 화면 폭에 따라 그리는 구조나 문구가 달라질 때만
 * 쓴다. `BELOW_*_QUERY`를 쓰면 CSS 변형과 같은 경계에서 바뀐다. 서버는 로딩 화면만 그려서 서버 값은
 * 쓰이지 않지만, 하이드레이션에 맞춰 `false`다. 클라이언트는 첫 그림부터 실제 값을 읽어, 폰에서
 * 데스크톱 구조를 한 번 그렸다 걷어내지 않는다.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
