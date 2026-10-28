import { useMutation } from "@tanstack/react-query";
import type { LyricsSearchQuery } from "#shared";
import { fetchLyricsSong, searchLyrics } from "./lyricsApi";

/**
 * 가사 후보 찾기. 입력할 때마다 외부 사이트를 부르지 않도록 쿼리가 아니라 버튼을 누를 때만
 * 보내는 변경으로 둔다.
 *
 * `networkMode: 'always'`인 것은 오프라인에서 요청을 멈춰 두면 온라인이 되는 순간 사용자가 잊은
 * 요청이 나가기 때문이다. 닿지 못하면 `OfflineError`로 바로 끝낸다.
 */
export function useSearchLyrics() {
  return useMutation({
    mutationFn: (query: LyricsSearchQuery) => searchLyrics(query),
    networkMode: "always",
  });
}

export function useFetchLyricsSong() {
  return useMutation({
    mutationFn: (ids: readonly string[]) => fetchLyricsSong(ids),
    networkMode: "always",
  });
}
