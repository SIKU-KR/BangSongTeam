import {
  LyricsSearchResponseSchema,
  LyricsSongResponseSchema,
  type LyricsCandidate,
  type LyricsSearchQuery,
  type LyricsSongResponse,
} from "#shared";
import { api } from "./client";
import { callApi } from "./request";

/** gasazip에서 제목(과 가수)으로 가사 후보를 찾는다. 순위는 서버가 매긴다. */
export async function searchLyrics(
  query: LyricsSearchQuery,
): Promise<LyricsCandidate[]> {
  const body = await callApi(() => api.api.lyrics.search.$get({ query }));
  return LyricsSearchResponseSchema.parse(body).candidates;
}

/** 후보의 곡 번호를 차례로 시도해 처음으로 가사가 있는 곡을 받는다. */
export async function fetchLyricsSong(
  ids: readonly string[],
): Promise<LyricsSongResponse> {
  const body = await callApi(() =>
    api.api.lyrics.song.$get({ query: { ids: ids.join(",") } }),
  );
  return LyricsSongResponseSchema.parse(body);
}
