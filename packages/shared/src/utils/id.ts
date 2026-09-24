import { nanoid } from "nanoid";

/**
 * 새 엔터티 id (NanoID 21자). `IdSchema`를 항상 통과한다.
 *
 * 브라우저·workerd·Node 모두 Web Crypto 난수를 쓴다.
 * `crypto.randomUUID()`는 쓰지 않는다 (ESLint가 막는다).
 */
export function createId(): string {
  return nanoid();
}

/**
 * 슬라이드 id. 덱 안에서만 쓰이는 로컬 id라 JSON 페이로드를 줄이려고
 * 짧게 만든다 (TECH_SPEC §4.0 경량 `s_` id).
 */
export function createSlideId(): string {
  return `s_${nanoid(10)}`;
}
