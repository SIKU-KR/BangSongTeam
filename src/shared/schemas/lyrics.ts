import { z } from "zod";
import { MAX_DECK_ARTIST_LENGTH, MAX_DECK_TITLE_LENGTH } from "./deck";

/** 후보 하나가 품는 gasazip 곡 번호의 최대 개수. 같은 곡이 여러 번 등록돼 있을 때 가사가 빈 곳을 건너뛰는 데 쓴다. */
export const MAX_LYRICS_CANDIDATE_IDS = 5;

/** 제목으로 후보를 찾는 검색어 길이 상한 */
export const MAX_LYRICS_SEARCH_LENGTH = 100;

const GasazipIdSchema = z.string().regex(/^\d{1,12}$/);

export const LyricsSearchQuerySchema = z.object({
  title: z.string().trim().min(1).max(MAX_LYRICS_SEARCH_LENGTH),
  artist: z.string().trim().max(MAX_DECK_ARTIST_LENGTH).default(""),
});
export type LyricsSearchQuery = z.infer<typeof LyricsSearchQuerySchema>;

export const LyricsCandidateSchema = z.object({
  title: z.string().max(MAX_DECK_TITLE_LENGTH),
  artist: z.string().max(MAX_DECK_ARTIST_LENGTH),
  ids: z.array(GasazipIdSchema).min(1).max(MAX_LYRICS_CANDIDATE_IDS),
});
export type LyricsCandidate = z.infer<typeof LyricsCandidateSchema>;

export const LyricsSearchResponseSchema = z.object({
  candidates: z.array(LyricsCandidateSchema),
});
export type LyricsSearchResponse = z.infer<typeof LyricsSearchResponseSchema>;

export const LyricsSongQuerySchema = z.object({
  ids: z
    .string()
    .transform((value) => value.split(","))
    .pipe(z.array(GasazipIdSchema).min(1).max(MAX_LYRICS_CANDIDATE_IDS)),
});

export const LyricsSongResponseSchema = z.object({
  title: z.string().max(MAX_DECK_TITLE_LENGTH),
  artist: z.string().max(MAX_DECK_ARTIST_LENGTH),
  lyrics: z.string().min(1),
});
export type LyricsSongResponse = z.infer<typeof LyricsSongResponseSchema>;
