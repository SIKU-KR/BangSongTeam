import { disassemble, getChoseong, convertQwertyToHangul } from "es-hangul";
import type { Deck } from "../schemas/deck";

/**
 * 초성·자모 분해 및 영타 오타 변환을 지원하는 한글 검색 일치 여부를 판별한다.
 */
export function hangulIncludes(
  target: string | null | undefined,
  query: string,
): boolean {
  if (!query || !query.trim()) return true;
  if (!target) return false;

  const cleanQuery = query.trim().toLowerCase();
  const cleanTarget = target.toLowerCase();

  if (cleanTarget.includes(cleanQuery)) {
    return true;
  }

  const targetDisassembled = disassemble(cleanTarget);
  const queryDisassembled = disassemble(cleanQuery);
  if (targetDisassembled.includes(queryDisassembled)) {
    return true;
  }

  const targetChoseong = getChoseong(cleanTarget);
  if (targetChoseong.includes(cleanQuery)) {
    return true;
  }

  const targetChoseongNoSpace = targetChoseong.replace(/\s+/g, "");
  const queryNoSpace = cleanQuery.replace(/\s+/g, "");
  if (queryNoSpace && targetChoseongNoSpace.includes(queryNoSpace)) {
    return true;
  }

  try {
    const convertedHangul = convertQwertyToHangul(cleanQuery);
    if (convertedHangul && convertedHangul !== cleanQuery) {
      if (cleanTarget.includes(convertedHangul)) return true;
      if (targetDisassembled.includes(disassemble(convertedHangul)))
        return true;
      if (targetChoseong.includes(convertedHangul)) return true;
    }
  } catch (error) {
    void error;
  }

  return false;
}

/**
 * 곡 검색. 제목·아티스트·가사 중 하나라도 맞으면 통과한다. 곡 선택 창과 드라이브가
 * 같은 기준으로 곡을 찾도록 한 곳에 둔다.
 */
export function deckMatchesQuery(
  deck: Pick<Deck, "title" | "artist" | "lyricsRaw">,
  query: string,
): boolean {
  return (
    hangulIncludes(deck.title, query) ||
    hangulIncludes(deck.artist, query) ||
    hangulIncludes(deck.lyricsRaw, query)
  );
}
