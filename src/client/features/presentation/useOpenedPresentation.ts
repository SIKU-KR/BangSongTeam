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
 *
 * 주소의 프레젠테이션이 화면을 그린 뒤에 도착해도(부팅 동기화가 받은 다른 기기의 프레젠테이션)
 * 그때 연다. 편집 함수는 열린 프레젠테이션을 고치는데 병합은 앞서 열려 있던 것을 그대로 두므로,
 * 열지 않으면 화면은 주소의 프레젠테이션을 보여 주면서 편집은 다른 프레젠테이션에 들어간다.
 */
export function useOpenedPresentation(
  id: string | undefined,
): OpenedPresentation {
  const found = usePresentationById(id);
  const isFound = found !== undefined;

  useLayoutEffect(() => {
    if (id && isFound) openPresentation(id);
  }, [id, isFound]);

  return { found, presentation: found ?? EMPTY_PRESENTATION };
}
