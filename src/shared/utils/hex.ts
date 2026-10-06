export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Web Crypto 난수 `byteLength`바이트를 소문자 16진수로 만든다.
 *
 * 브라우저가 만드는 `traceparent`와 Worker가 대신 만드는 상관 ID가 같은 꼴이어야
 * Worker 로그에서 둘을 같은 방식으로 찾을 수 있어 한 곳에 둔다.
 */
export function randomHex(byteLength: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}
