import {
  createId,
  DeckSchema,
  DEFAULT_DECK_STYLE,
  splitLyricsIntoSlides,
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
 */
export function createSongDeck(input: CreateSongDeckInput): Deck {
  const now = new Date().toISOString();
  return DeckSchema.parse({
    id: createId(),
    userId: input.userId,
    scope: "library",
    presentationId: null,
    title: input.title.trim(),
    artist: input.artist?.trim() ?? "",
    lyricsRaw: input.lyricsRaw,
    slides: splitLyricsIntoSlides(input.lyricsRaw),
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
