import {
  clampText,
  createId,
  DeckSchema,
  DEFAULT_DECK_STYLE,
  MAX_DECK_ARTIST_LENGTH,
  MAX_DECK_TITLE_LENGTH,
  splitLyricsIntoSlides,
  toWellFormedText,
  type Deck,
} from "#shared";

interface CreateSongDeckInput {
  userId: string;
  title: string;
  artist?: string;
  lyricsRaw: string;
}

/**
 * 가사로 새 보관함 곡을 만든다. 비공개, 기본 서식, 배경 없음으로 시작하고, 제목·아티스트의
 * 앞뒤 공백은 저장 전에 걷어 낸다. 아직 어느 프레젠테이션에도 속하지 않으므로
 * `presentationId`는 비운다.
 *
 * 제목·아티스트는 곡 한도로 줄인다. 입력 칸의 `maxLength`는 검색어로 채운 제목처럼 코드로 넣은
 * 값을 막지 못하고, 한도를 넘으면 `DeckSchema.parse`가 저장 버튼의 클릭 처리 안에서 던져 아무
 * 일도 일어나지 않는다. 붙여 넣은 글에 남은 서로게이트 반쪽은 U+FFFD로 바꾼다.
 */
export function createSongDeck(input: CreateSongDeckInput): Deck {
  const now = new Date().toISOString();
  const lyricsRaw = toWellFormedText(input.lyricsRaw);
  return DeckSchema.parse({
    id: createId(),
    userId: input.userId,
    scope: "library",
    presentationId: null,
    title: clampText(
      toWellFormedText(input.title).trim(),
      MAX_DECK_TITLE_LENGTH,
    ),
    artist: clampText(
      toWellFormedText(input.artist ?? "").trim(),
      MAX_DECK_ARTIST_LENGTH,
    ),
    lyricsRaw,
    slides: splitLyricsIntoSlides(lyricsRaw),
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    visibility: "private",
    forkedFrom: null,
    forkCount: 0,
    origin: "user",
    createdAt: now,
    updatedAt: now,
  });
}
