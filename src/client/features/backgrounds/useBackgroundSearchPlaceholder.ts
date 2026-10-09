import { useRotatingValue } from "#hooks/useRotatingValue";
import { BACKGROUND_COPY } from "#copy/backgrounds";

const EXAMPLE_INTERVAL_MS = 3500;

/**
 * 배경 검색창 플레이스홀더. 벡터 검색은 말하듯 적을수록 잘 찾으므로 안내 문구 대신
 * 실제 검색어 예시를 돌려 가며 보여 준다. 입력란에 글자가 있으면 돌리지 않는다.
 */
export function useBackgroundSearchPlaceholder(isEmpty: boolean): string {
  return BACKGROUND_COPY.searchExample(
    useRotatingValue(
      BACKGROUND_COPY.searchExamples,
      EXAMPLE_INTERVAL_MS,
      isEmpty,
    ),
  );
}
