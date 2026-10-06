const QUOTA_ERROR_NAMES = new Set([
  "QuotaExceededError",
  "NS_ERROR_DOM_QUOTA_REACHED",
]);

const LEGACY_QUOTA_ERROR_CODE = 22;

/**
 * 저장 공간 한도에 걸린 오류인지.
 *
 * 브라우저마다 같은 한도 초과를 다른 이름(Firefox의 `NS_ERROR_DOM_QUOTA_REACHED`)이나
 * 옛 DOMException 코드(22)로 알린다. IndexedDB 저장과 미디어 캐시가 같은 규칙으로
 * 판정해야 '저장 공간 부족' 안내가 어느 쪽에서든 똑같이 뜬다.
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (err instanceof DOMException && err.code === LEGACY_QUOTA_ERROR_CODE) {
    return true;
  }
  return (
    (err instanceof Error || err instanceof DOMException) &&
    QUOTA_ERROR_NAMES.has(err.name)
  );
}
