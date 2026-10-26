import { nanoid } from "nanoid";
import { isReservedDocumentId } from "../schemas/id";

/**
 * 새 엔터티 id (NanoID 21자). `IdSchema`를 항상 통과하고, Firestore 문서 id로 언제나 쓸 수
 * 있다. Firestore가 예약한 `__…__` 꼴이 나오면 다시 만든다. 그런 id의 곡·프레젠테이션은
 * 서버에 영영 저장되지 않는다.
 *
 * 브라우저·workerd·Node 모두 Web Crypto 난수를 쓴다.
 * `crypto.randomUUID()`는 쓰지 않는다 (ESLint가 막는다).
 */
export function createId(): string {
  let id = nanoid();
  while (isReservedDocumentId(id)) id = nanoid();
  return id;
}

/**
 * 슬라이드 id. 덱 안에서만 쓰이는 로컬 id라 JSON 페이로드를 줄이려고 짧게 만든다 (`s_` 접두사 id).
 */
export function createSlideId(): string {
  return `s_${nanoid(10)}`;
}
