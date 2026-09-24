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
export type Id = z.infer<typeof IdSchema>;
