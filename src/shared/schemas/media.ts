import { z } from "zod";
import { IdSchema } from "./id";
import { MEDIA_URL_PREFIX } from "../constants/projection";

export const BackgroundKindSchema = z.enum(["video", "image"]);
export type BackgroundKind = z.infer<typeof BackgroundKindSchema>;

const MediaUrlSchema = z.string().startsWith(MEDIA_URL_PREFIX);

/**
 * 클라이언트가 보는 배경 한 건.
 *
 * URL은 동일 출처 미디어 프록시(`/api/media/*`) 상대 경로다. 송출 화면은 이 값을
 * IndexedDB에서 읽어 그대로 재생하므로 서버에 다시 묻지 않는다.
 * `posterUrl`은 목록·썸네일용 축소본(폭 960px)이다. 포스터 없이 올라간 예전 이미지
 * 배경만 `mediaUrl`과 `posterUrl`이 같다.
 *
 * `description`·`keywords`는 스틸컷을 보고 만든 검색 메타데이터다
 * (`data/backgrounds/*.json`). 갤러리 검색은 이 값과 제목을 기기에서 비교한다. 이 필드가
 * 생기기 전에 IndexedDB에 담긴 사본도 송출 화면이 읽을 수 있게 빈 값을 기본으로 둔다.
 */
export const BackgroundMediaSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  kind: BackgroundKindSchema,
  mediaUrl: MediaUrlSchema,
  posterUrl: MediaUrlSchema,
  durationSec: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  license: z.string(),
  createdAt: z.iso.datetime(),
  description: z.string().default(""),
  keywords: z.array(z.string()).default([]),
});
export type BackgroundMedia = z.infer<typeof BackgroundMediaSchema>;

/** 배경 목록 응답. 모든 배경이 한 갤러리에 모두에게 똑같이 보인다 */
export const BackgroundListResponseSchema = z.object({
  backgrounds: z.array(BackgroundMediaSchema),
});
export type BackgroundListResponse = z.infer<
  typeof BackgroundListResponseSchema
>;

/**
 * 배경 목록 응답의 겉모양만 본다. 클라이언트는 이것으로 받은 뒤 `BackgroundMediaSchema`에 맞는
 * 배경만 쓴다. 운영자가 손으로 고친 배경 하나가 형식을 어기면 목록 전체가 검증에 걸려 모든
 * 기기가 새 목록을 받지 못하기 때문이다.
 */
export const BackgroundListEnvelopeSchema = BackgroundListResponseSchema.extend(
  { backgrounds: z.array(z.unknown()) },
);
