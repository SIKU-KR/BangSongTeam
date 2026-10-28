import {
  MAX_DECK_ARTIST_LENGTH,
  MAX_DECK_TITLE_LENGTH,
  MAX_LYRICS_CANDIDATE_IDS,
  clampText,
  type LyricsCandidate,
} from "#shared";
import type { GasazipRow } from "./gasazip";

const MAX_CANDIDATES = 10;
const REQUEST_NOTE = /^\s*\([^)]*님[^)]*\)\s*/;
const MP3_SUFFIX = /\.mp3\s*$/i;
const TRACK_PREFIX = /^\d+\.\s*.+?\s+-\s+(.+)$/;

const SCORE = {
  titleExact: 100,
  titlePrefix: 60,
  titleIncluded: 40,
  artistExact: 50,
  artistIncluded: 25,
} as const;

function cleanRow(row: GasazipRow): GasazipRow | null {
  let title = row.title.replace(REQUEST_NOTE, "");
  if (MP3_SUFFIX.test(title)) {
    title = title.replace(MP3_SUFFIX, "");
    title = TRACK_PREFIX.exec(title)?.[1] ?? title;
  }
  title = title.trim();
  if (!title) return null;
  return {
    id: row.id,
    title,
    artist: row.artist.replace(REQUEST_NOTE, "").trim(),
  };
}

function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

interface Group {
  title: string;
  artist: string;
  ids: string[];
  key: { title: string; artist: string };
  firstIndex: number;
}

function scoreOf(
  group: Group,
  query: { title: string; artist: string },
): number {
  let score = 0;
  if (query.title) {
    if (group.key.title === query.title) score += SCORE.titleExact;
    else if (group.key.title.startsWith(query.title)) {
      score += SCORE.titlePrefix;
    } else if (group.key.title.includes(query.title)) {
      score += SCORE.titleIncluded;
    }
  }
  if (query.artist && group.key.artist) {
    if (group.key.artist === query.artist) score += SCORE.artistExact;
    else if (
      group.key.artist.includes(query.artist) ||
      query.artist.includes(group.key.artist)
    ) {
      score += SCORE.artistIncluded;
    }
  }
  return score;
}

/**
 * gasazip 검색 행을 사용자에게 보여 줄 후보 목록으로 다듬는다.
 *
 * 신청곡 표기(`(…님)`), 트랙 번호가 붙은 `.mp3` 파일명 제목을 정리한 뒤, 정규화한 (제목, 가수)가
 * 같은 행을 한 후보로 묶는다. 같은 곡이 여러 번 등록된 경우가 많아서, 묶음의 곡 번호를 모두 들고
 * 있다가 앞 번호의 가사가 비면 다음 번호로 넘어갈 수 있게 한다.
 *
 * 점수가 같으면 많이 등록된 쪽, 그다음 gasazip이 준 순서를 따른다.
 */
export function rankLyricsCandidates(
  rows: readonly GasazipRow[],
  query: { title: string; artist?: string },
): LyricsCandidate[] {
  const groups = new Map<string, Group>();
  rows.forEach((row, index) => {
    const cleaned = cleanRow(row);
    if (!cleaned) return;
    const key = {
      title: normalize(cleaned.title),
      artist: normalize(cleaned.artist),
    };
    if (!key.title) return;
    const groupKey = `${key.title}\u0000${key.artist}`;
    const group = groups.get(groupKey);
    if (group) {
      if (!group.ids.includes(cleaned.id)) group.ids.push(cleaned.id);
      return;
    }
    groups.set(groupKey, {
      title: cleaned.title,
      artist: cleaned.artist,
      ids: [cleaned.id],
      key,
      firstIndex: index,
    });
  });

  const normalizedQuery = {
    title: normalize(query.title),
    artist: normalize(query.artist ?? ""),
  };
  return [...groups.values()]
    .map((group) => ({ group, score: scoreOf(group, normalizedQuery) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.group.ids.length - a.group.ids.length ||
        a.group.firstIndex - b.group.firstIndex,
    )
    .slice(0, MAX_CANDIDATES)
    .map(({ group }) => ({
      title: clampText(group.title, MAX_DECK_TITLE_LENGTH),
      artist: clampText(group.artist, MAX_DECK_ARTIST_LENGTH),
      ids: group.ids.slice(0, MAX_LYRICS_CANDIDATE_IDS),
    }));
}
