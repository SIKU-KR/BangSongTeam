import { useEffect, useRef, useState } from "react";
import type { Presentation } from "#shared";
import { warmPresentationFonts } from "../../lib/offline";

/** 송출 시작 때 가사 글꼴을 기다리는 최대 시간. 넘기면 대체 글꼴로라도 가사를 보인다. */
export const FONT_READY_TIMEOUT_MS = 1500;

/**
 * 세트 글꼴을 지연 없이 불러오고, 끝나거나 제한 시간이 지나면 `true`를 돌려준다.
 *
 * 송출 화면은 이 값이 `true`가 될 때까지 가사를 숨긴다. 글꼴이 `font-display: swap`이라
 * 곧바로 그리면 첫 슬라이드가 대체 글꼴로 나왔다가 바뀐다. 세트마다 한 번만 기다린다.
 */
export function usePresentationFontsReady(
  presentation: Presentation | null,
): boolean {
  const presentationId = presentation?.id ?? null;
  const [readyId, setReadyId] = useState<string | null>(null);
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;

  useEffect(() => {
    const current = presentationRef.current;
    if (!presentationId || !current) return;

    let cancelled = false;
    const markReady = (): void => {
      if (!cancelled) setReadyId(presentationId);
    };
    const timer = setTimeout(markReady, FONT_READY_TIMEOUT_MS);
    void warmPresentationFonts(current)
      .catch(() => undefined)
      .then(markReady);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [presentationId]);

  return presentationId !== null && readyId === presentationId;
}
