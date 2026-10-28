import { z } from "zod";

/**
 * 엔터티 id 형식: NanoID 기본값 (21자, URL-safe 알파벳 `A-Za-z0-9_-`).
 *
 * 사용자·세션·덱·프레젠테이션·항목·신고·배경 id가 모두 이 형식이다.
 * 2026-09-24에 UUID에서 바꿨고 옛 UUID는 받지 않는다 (호환 없음).
 * 새 id는 `createId()`(`utils/id.ts`)로만 만든다.
 */
export const ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;

export const IdSchema = z.string().regex(ID_PATTERN, "Invalid id");

const FIRESTORE_RESERVED_ID = /^__.*__$/;

/**
 * Firestore가 예약한 문서 id 꼴(`__…__`)인지. 이 id로 문서를 읽거나 쓰면 Firestore가
 * INVALID_ARGUMENT로 거절해 500이 된다. 21자 NanoID도 이 꼴일 수 있어 `IdSchema`만으로는
 * 거르지 못한다. 이 꼴의 문서는 있을 수 없으니 요청 id로 찾을 때는 없는 대상으로 다룬다.
 *
 * `IdSchema`를 좁히지 않는다. 항목 id처럼 필드 값으로만 저장되는 id는 이 꼴이어도
 * 정상이고, 클라이언트가 저장된 데이터를 읽을 때도 `IdSchema`를 쓴다.
 * https://firebase.google.com/docs/firestore/quotas#collections_documents_and_fields
 */
export function isReservedDocumentId(id: string): boolean {
  return FIRESTORE_RESERVED_ID.test(id);
}
