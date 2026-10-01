import {
  createId,
  DeckSchema,
  DEFAULT_DECK_STYLE,
  splitLyricsIntoSlides,
  type Deck,
  type DeckOrigin,
  type DeckScope,
  type Slide,
} from "#shared";

export interface CreateSongDeckInput {
  id?: string;
  userId: string;
  scope: DeckScope;
  title: string;
  artist?: string;
  lyricsRaw: string;
  /** 미리보기에 쓴 슬라이드를 그대로 넣을 때. 없으면 가사를 나눠 만든다 */
  slides?: Slide[];
  backgroundId?: string | null;
  /** 보관함 곡만 정한다. 프레젠테이션 곡은 복제본이라 비워 둔다 */
  origin?: DeckOrigin;
}

/**
 * 가사로 새 곡을 만든다. 보관함 곡과 프레젠테이션 곡이 같은 기본값(비공개, 기본 서식,
 * 배경 없음)으로 시작하게 한 곳에서 만들고, 제목·아티스트의 앞뒤 공백은 저장 전에
 * 걷어 낸다. 아직 어느 프레젠테이션에도 속하지 않으므로 `presentationId`는 비운다.
 */
export function createSongDeck(input: CreateSongDeckInput): Deck {
  const now = new Date().toISOString();
  return DeckSchema.parse({
    id: input.id ?? createId(),
    userId: input.userId,
    scope: input.scope,
    presentationId: null,
    title: input.title.trim(),
    artist: input.artist?.trim() ?? "",
    lyricsRaw: input.lyricsRaw,
    slides: input.slides ?? splitLyricsIntoSlides(input.lyricsRaw),
    backgroundId: input.backgroundId ?? null,
    style: DEFAULT_DECK_STYLE,
    visibility: "private",
    forkedFrom: null,
    forkCount: 0,
    ...(input.origin ? { origin: input.origin } : {}),
    createdAt: now,
    updatedAt: now,
  });
}
