import { useRef } from "react";

/**
 * 렌더마다 최신 값을 담는 ref.
 *
 * 이펙트가 의존성(문자열 키 등)이 바뀔 때만 다시 돌면서도, 타이머·이벤트 콜백이 불릴
 * 때는 그 사이에 바뀐 최신 값을 읽게 하려고 쓴다.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
