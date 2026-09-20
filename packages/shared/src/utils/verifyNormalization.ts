/**
 * LLM 가사 정규화 결과 검증 알고리즘 (TECH_SPEC 6.2, PRD 4.8)
 * - 입력 가사 버전들의 모든 비어있지 않은 라인을 공백 정규화(모든 공백 제거)하여 허용 집합(pool)을 구성한다.
 * - 생성된 정규화 가사의 모든 비어있지 않은 라인이 허용 집합에 존재하는지 검사한다.
 * - 입력 버전에 없는 가사가 1줄이라도 존재하면 환각(Hallucination)으로 간주하고 즉시 false를 반환한다.
 */
export function verifyNormalization(
  canonical: string,
  inputVersions: string[],
): boolean {
  const normalizeLine = (l: string) => l.replace(/\s+/g, "").trim();

  // 1. 모든 입력 버전의 유효 라인 집합(Set) 생성
  const validLinesPool = new Set<string>();
  for (const version of inputVersions) {
    for (const line of version.split(/\r?\n/)) {
      const cleaned = normalizeLine(line);
      if (cleaned.length > 0) {
        validLinesPool.add(cleaned);
      }
    }
  }

  // 2. 생성된 정규화 가사의 모든 라인이 풀에 존재하는지 전수 검사
  const canonicalLines = canonical.split(/\r?\n/);
  for (const line of canonicalLines) {
    const cleaned = normalizeLine(line);
    if (cleaned.length === 0) continue; // 빈 줄은 허용
    if (!validLinesPool.has(cleaned)) {
      // 입력에 없던 가사가 1줄이라도 생성되었을 경우 즉시 거부 (환각 감지)
      return false;
    }
  }

  return true;
}
