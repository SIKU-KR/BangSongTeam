import {
  DEFAULT_DECK_STYLE,
  DeckStyleSchema,
  fitSlidesToLimits,
  StoredSlideSchema,
  type Deck as SharedDeck,
  type DeckStyle,
  type Slide,
  type PresentationChanges,
  type PresentationDocument,
  type Folder as SharedFolder,
} from "#shared";
import type {
  Deck as DeckRow,
  Folder as FolderRow,
  NewFolder,
  NewDeck,
  Presentation as PresentationRow,
  NewPresentation,
} from "../schema";

/**
 * D1 행과 `#shared` DTO 사이의 변환을 한 곳에 모은다.
 *
 * 두 `Deck` 타입은 이름만 같고 실제로는 다르다:
 * - `#db`의 Deck: `slides`·`style`이 JSON TEXT(`string`), 타임스탬프가 `Date`
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

export function parseStyle(raw: string | null | undefined): DeckStyle {
  if (!raw) return { ...DEFAULT_DECK_STYLE };
  try {
    const result = DeckStyleSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : { ...DEFAULT_DECK_STYLE };
  } catch {
    return { ...DEFAULT_DECK_STYLE };
  }
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

function toDate(iso: string): Date {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/**
 * D1 덱 행 → 공유 Deck DTO.
 *
 * `scope`는 `presentation_id`가 있는지로, `origin`은 원작 표시 스냅샷
 * (`forked_from_author_name`)이 있는지로 정한다. 둘 다 저장하지 않는 파생값이다.
 */
export function toSharedDeck(row: DeckRow): SharedDeck {
  return {
    id: row.id,
    userId: row.userId,
    scope: row.presentationId ? "presentation" : "library",
    presentationId: row.presentationId ?? null,
    title: row.title,
    artist: row.artist,
    lyricsRaw: row.lyricsRaw,
    slides: parseSlides(row.slides),
    backgroundId: row.backgroundId ?? null,
    style: parseStyle(row.style),
    visibility: row.visibility,
    forkedFrom: row.forkedFrom ?? null,
    forkCount: row.forkCount,
    origin: row.forkedFromAuthorName ? "fork" : "user",
    forkedFromAuthorName: row.forkedFromAuthorName ?? null,
    publishedAt: toIsoOrNull(row.publishedAt),
    takedownAt: toIsoOrNull(row.takedownAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * 공유 Deck DTO의 곡 내용 → D1 덱 컬럼. id·소유자·소속·공개 상태·가져온 곡 정보는
 * 넣지 않는다. 그 값은 호출자가 서버 기준으로 정해 덧붙인다.
 */
export function toDeckContent(
  deck: SharedDeck,
): Pick<
  NewDeck,
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

/** 머리 행 + 사본 덱 행(`position` 순) → 하이드레이션된 문서 */
export function toPresentationDocument(
  presentation: PresentationRow,
  copies: DeckRow[],
): PresentationDocument {
  return {
    id: presentation.id,
    userId: presentation.userId,
    title: presentation.title,
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

export interface PresentationSlot {
  itemId: string;
  deckId: string;
  position: number;
}

export interface DecomposedDocument {
  presentation: NewPresentation;
  slots: PresentationSlot[];
  decks: NewDeck[];
}

/**
 * 변경분 저장 본문 → 정규화된 행들. `slots`는 항목 순서대로 매긴 자리이고,
 * `decks`에는 본문에 담겼고 자리가 있는 사본만 나온다.
 *
 * 사본의 소유자·소속·자리는 문서 헤더와 항목 기준으로 덮어쓴다. 본문이 보내온 값을
 * 그대로 믿으면 남의 계정으로 문서를 심거나, 보관함 곡을 사본으로 둔갑시킬 수 있다.
 * 사본은 공유 대상이 아니라 공개 상태 컬럼은 기본값(비공개)으로 둔다. `forkedFrom`
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

/** D1 폴더 행 → 공유 Folder DTO */
export function toSharedFolder(row: FolderRow | NewFolder): SharedFolder {
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

/** 공유 Folder DTO → D1 폴더 행 */
export function toFolderRow(folder: SharedFolder): NewFolder {
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
