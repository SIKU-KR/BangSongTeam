import { useLayoutEffect } from "react";
import type { Presentation } from "#shared";
import { openPresentation, usePresentationById } from "./presentationStore";

const EMPTY_PRESENTATION: Presentation = {
  id: "",
  userId: "",
  title: "",
  serviceDate: "",
  items: [],
  createdAt: "",
  updatedAt: "",
};

interface OpenedPresentation {
  /** 스토어에 없으면 `undefined`. 라우트는 이 값으로 다른 화면으로 보낼지 정한다 */
  found: Presentation | undefined;
  /** `found`가 없을 때도 그릴 수 있게 빈 프레젠테이션으로 채운 값 */
  presentation: Presentation;
}

/**
 * 주소의 프레젠테이션을 활성 문서로 연다.
 *
 * 레이아웃 이펙트를 쓰는 것은 첫 페인트 전에 활성 문서가 바뀌어야 하기 때문이다.
 */
export function useOpenedPresentation(
  id: string | undefined,
): OpenedPresentation {
  const found = usePresentationById(id);

  useLayoutEffect(() => {
    if (id) openPresentation(id);
  }, [id]);

  return { found, presentation: found ?? EMPTY_PRESENTATION };
}
