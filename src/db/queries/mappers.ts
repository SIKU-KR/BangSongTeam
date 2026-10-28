import {
  clampText,
  DEFAULT_DECK_STYLE,
  DeckStyleSchema,
  fitDeckText,
  fitSlidesToLimits,
  MAX_FIRESTORE_TIME,
  MAX_PRESENTATION_TITLE_LENGTH,
  StoredSlideSchema,
  UNTITLED_SONG,
  type Deck as SharedDeck,
  type DeckStyle,
  type Slide,
  type OmittedPresentation,
  type PresentationChanges,
  type PresentationDocument,
  type Folder as SharedFolder,
} from "#shared";
import type { DeckDoc, FolderDoc, PresentationDoc } from "../collections";

/**
 * Firestore 문서와 `#shared` DTO 사이의 변환을 한 곳에 모은다.
 *
 * 두 곡 타입은 모양이 다르다:
 * - `#db`의 DeckDoc: `slides`·`style`이 JSON 문자열, 타임스탬프가 `Date`
 * - `#shared`의 Deck: `slides: Slide[]`, `style: DeckStyle`, 타임스탬프가 ISO 문자열
 *
 * 라우트마다 `JSON.parse`를 흩뿌리면 한쪽만 고쳐져 조용히 어긋난다.
 */

export function parseSlides(raw: string | null | undefined): Slide[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return fitSlidesToLimits(
    parsed.flatMap((candidate) => {
      const result = StoredSlideSchema.safeParse(candidate);
      return result.success ? [result.data] : [];
    }),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 저장된 스타일 JSON → 스타일. 스키마를 통과하지 못한 필드만 기본값으로 바꾸고 나머지는
 * 살린다.
 *
 * 다른 판(배포 중의 새 판, 되돌린 판)이 저장한 스타일에는 이 판이 모르는 글꼴 같은 값이 있을 수
 * 있다. 필드 하나 때문에 스타일 전체를 기본값으로 돌리면, 그 응답을 받아 다시 저장하는
 * 클라이언트가 사용자의 글자 크기·색·위치를 모두 지운다. JSON이 깨졌거나 객체가 아니면 기본
 * 스타일이다.
 */
export function parseStyle(raw: string | null | undefined): DeckStyle {
  if (!raw) return { ...DEFAULT_DECK_STYLE };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_DECK_STYLE };
  }

  const result = DeckStyleSchema.safeParse(parsed);
  if (result.success) return result.data;
  if (!isPlainObject(parsed)) return { ...DEFAULT_DECK_STYLE };

  const kept = Object.fromEntries(
    Object.entries(DeckStyleSchema.shape).flatMap(([key, field]) =>
      key in parsed && field.safeParse(parsed[key]).success
        ? [[key, parsed[key]]]
        : [],
    ),
  );
  const repaired = DeckStyleSchema.safeParse(kept);
  return repaired.success ? repaired.data : { ...DEFAULT_DECK_STYLE };
}

function toIso(value: Date | null | undefined): string {
  return (value ?? new Date(0)).toISOString();
}

function toIsoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toDateOrNull(iso: string | null | undefined): Date | null {
  return iso ? toDate(iso) : null;
}

/**
 * Firestore Timestamp가 담는 범위(0001-01-01 ~ 9999-12-31, UTC). 본문의 ISO 문자열은
 * `0000`년도 통과하는데, 그대로 쓰면 Timestamp 변환이 던져 저장이 500이 된다.
 * https://github.com/protocolbuffers/protobuf/blob/main/src/google/protobuf/timestamp.proto
 */
const MIN_FIRESTORE_TIME = Date.parse("0001-01-01T00:00:00.000Z");

function toDate(iso: string): Date {
  const time = new Date(iso).getTime();
  return time >= MIN_FIRESTORE_TIME && time <= MAX_FIRESTORE_TIME
    ? new Date(time)
    : new Date(0);
}

/**
 * 곡 문서 → 공유 Deck DTO.
 *
 * `scope`는 `presentationId`가 있는지로 정한다. 저장하지 않는 파생값이다.
 *
 * 제목·아티스트·원작자 이름은 `DeckSchema` 한도에 맞춰 읽는다(`fitDeckText`). 시드·옮긴 데이터에 한도를 넘는 값이 있어도 이 DTO를 엄격하게 검사하는
 * 클라이언트가 곡이나 그 곡을 담은 프레젠테이션 전체를 버리지 않게 하기 위해서다. 한도 안의
 * 값은 그대로다.
 */
export function toSharedDeck(row: DeckDoc): SharedDeck {
  const text = fitDeckText(row);
  return {
    id: row.id,
    userId: row.userId,
    scope: row.presentationId ? "presentation" : "library",
    presentationId: row.presentationId ?? null,
    title: text.title,
    artist: text.artist,
    lyricsRaw: row.lyricsRaw,
    slides: parseSlides(row.slides),
    backgroundId: row.backgroundId ?? null,
    style: parseStyle(row.style),
    forkedFrom: row.forkedFrom ?? null,
    forkedFromAuthorName: text.forkedFromAuthorName,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * 공유 Deck DTO의 곡 내용 → 곡 문서 필드. id·소유자·소속·가져온 곡 정보는
 * 넣지 않는다. 그 값은 호출자가 서버 기준으로 정해 덧붙인다.
 */
export function toDeckContent(
  deck: SharedDeck,
): Pick<
  DeckDoc,
  | "title"
  | "artist"
  | "lyricsRaw"
  | "slides"
  | "style"
  | "backgroundId"
  | "createdAt"
  | "updatedAt"
> {
  return {
    title: deck.title,
    artist: deck.artist,
    lyricsRaw: deck.lyricsRaw,
    slides: JSON.stringify(deck.slides),
    style: JSON.stringify(deck.style),
    backgroundId: deck.backgroundId ?? null,
    createdAt: toDate(deck.createdAt),
    updatedAt: toDate(deck.updatedAt),
  };
}

/**
 * 머리 문서 + 사본 곡 문서(`position` 순) → 하이드레이션된 문서.
 *
 * 제목은 문서 스키마 한도로 줄이고, 비었거나 문자열이 아니면 '(제목 없음)'으로 읽는다. 목록
 * 조회는 모든 문서를 한 응답에 담으므로, 한 문서의 잘못된 제목이 응답 전체를 깨뜨리지 않게
 * 한다.
 */
export function toPresentationDocument(
  presentation: PresentationDoc,
  copies: DeckDoc[],
): PresentationDocument {
  const title: unknown = presentation.title;
  return {
    id: presentation.id,
    userId: presentation.userId,
    title:
      typeof title === "string" && title.length > 0
        ? clampText(title, MAX_PRESENTATION_TITLE_LENGTH)
        : UNTITLED_SONG,
    serviceDate: presentation.serviceDate,
    folderId: presentation.folderId ?? null,
    trashedAt: toIsoOrNull(presentation.trashedAt),
    items: copies.map((deck) => ({
      id: deck.itemId as string,
      presentationId: presentation.id,
      deckId: deck.id,
      order: deck.position as number,
      deck: toSharedDeck(deck),
    })),
    createdAt: toIso(presentation.createdAt),
    updatedAt: toIso(presentation.updatedAt),
  };
}

/**
 * 머리 문서 → 곡 사본을 뺀 목록 한 줄(`OmittedPresentationSchema`). 머리 필드는
 * `toPresentationDocument`와 똑같이 읽어, 같은 판이면 사본을 담아 보낸 문서와 머리가 같다.
 */
export function toOmittedPresentation(
  presentation: PresentationDoc,
): OmittedPresentation {
  return {
    ...toPresentationDocument(presentation, []),
    items: null,
    copiesOmitted: true,
  };
}

export interface PresentationSlot {
  itemId: string;
  deckId: string;
  position: number;
}

/** 저장 본문에서 온 머리 필드. 폴더·휴지통은 본문에 있을 때만 바꾼다 */
export type PresentationHeader = Pick<
  PresentationDoc,
  "id" | "userId" | "title" | "serviceDate" | "createdAt" | "updatedAt"
> &
  Partial<Pick<PresentationDoc, "folderId" | "trashedAt">>;

export interface DecomposedDocument {
  presentation: PresentationHeader;
  slots: PresentationSlot[];
  decks: DeckDoc[];
}

/**
 * 변경분 저장 본문 → 머리 필드와 사본 곡 문서. `slots`는 항목 순서대로 매긴 자리이고,
 * `decks`에는 본문에 담겼고 자리가 있는 사본만 나온다.
 *
 * 사본의 소유자·소속·자리는 문서 헤더와 항목 기준으로 덮어쓴다. 본문이 보내온 값을
 * 그대로 믿으면 남의 계정으로 문서를 심거나, 보관함 곡을 사본으로 둔갑시킬 수 있다.
 * `forkedFrom`
 * (담아 온 보관함 곡)과 `forkedFromAuthorName`(원작 표시)은 편집기가 쓰는 값이라
 * 그대로 둔다.
 */
export function fromPresentationChanges(
  changes: PresentationChanges,
): DecomposedDocument {
  const slots = [...changes.items]
    .sort((a, b) => a.order - b.order)
    .map((item, position) => ({
      itemId: item.id,
      deckId: item.deckId,
      position,
    }));
  const slotByDeck = new Map(slots.map((slot) => [slot.deckId, slot]));

  return {
    presentation: {
      id: changes.id,
      userId: changes.userId,
      title: changes.title,
      serviceDate: changes.serviceDate,
      ...(changes.folderId === undefined ? {} : { folderId: changes.folderId }),
      ...(changes.trashedAt === undefined
        ? {}
        : { trashedAt: toDateOrNull(changes.trashedAt) }),
      createdAt: toDate(changes.createdAt),
      updatedAt: toDate(changes.updatedAt),
    },
    slots,
    decks: changes.decks.flatMap((deck) => {
      const slot = slotByDeck.get(deck.id);
      if (!slot) return [];
      return [
        {
          id: deck.id,
          ...toDeckContent(deck),
          userId: changes.userId,
          presentationId: changes.id,
          itemId: slot.itemId,
          position: slot.position,
          forkedFrom: deck.forkedFrom ?? null,
          forkedFromAuthorName: deck.forkedFromAuthorName ?? null,
        },
      ];
    }),
  };
}

/** 폴더 문서 → 공유 Folder DTO */
export function toSharedFolder(row: FolderDoc): SharedFolder {
  return {
    id: row.id,
    userId: row.userId,
    parentId: row.parentId ?? null,
    name: row.name,
    trashedAt: toIsoOrNull(row.trashedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** 공유 Folder DTO → 폴더 문서 */
export function toFolderDoc(folder: SharedFolder): FolderDoc {
  return {
    id: folder.id,
    userId: folder.userId,
    parentId: folder.parentId,
    name: folder.name,
    trashedAt: toDateOrNull(folder.trashedAt),
    createdAt: toDate(folder.createdAt),
    updatedAt: toDate(folder.updatedAt),
  };
}
