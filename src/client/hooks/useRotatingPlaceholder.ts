import { useEffect, useState } from "react";

const ROTATION_MS = 3500;

/**
 * 입력란 플레이스홀더. 여러 개를 받으면 일정 간격으로 돌려 가며 보여 준다(배경 검색의
 * 예시 검색어). 타이머 상태를 입력란 안에 두어야 돌 때마다 화면 전체가 다시 그려지지
 * 않는다. 입력란에 글자가 있으면 보이지 않으니 `paused`로 멈춘다.
 */
export function useRotatingPlaceholder(
  placeholder: string | readonly string[] | undefined,
  paused: boolean,
): string | undefined {
  const count =
    typeof placeholder === "string" ? 1 : (placeholder?.length ?? 0);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (paused || count < 2) return;
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % count),
      ROTATION_MS,
    );
    return () => clearInterval(timer);
  }, [paused, count]);
  return typeof placeholder === "string"
    ? placeholder
    : placeholder?.[index % count];
}
