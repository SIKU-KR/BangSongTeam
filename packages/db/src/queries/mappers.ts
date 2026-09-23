import {
  DEFAULT_DECK_STYLE,
  DeckStyleSchema,
  SlideSchema,
  type Deck as SharedDeck,
  type DeckStyle,
  type Slide,
  type PresentationDocument,
} from "@repo/shared";
import type {
  Deck as DeckRow,
  NewDeck,
  Presentation as PresentationRow,
  NewPresentation,
  NewPresentationItem,
  PresentationItem as PresentationItemRow,
} from "../schema";

/**
 * D1 행과 `@repo/shared` DTO 사이의 변환을 한 곳에 모은다.
 *
 * 두 `Deck` 타입은 이름만 같고 실제로는 다르다:
 * - `packages/db`의 Deck: `slides`·`style`이 JSON TEXT(`string`), 타임스탬프가 `Date | null`
 * - `@repo/shared`의 Deck: `slides: Slide[]`, `style: DeckStyle`, 타임스탬프가 ISO 문자열
 *
 * 라우트마다 `JSON.parse`를 흩뿌리면 한쪽만 고쳐져 조용히 어긋난다.
 */

/** 저장본이 깨져 있어도 목록 전체가 죽지 않도록 복구한다 */
function parseSlides(raw: string | null | undefined): Slide[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  // 항목 단위로 검증한다. 배열 전체를 한 번에 파싱하면 슬라이드 하나가
  // 깨졌을 때 그 곡의 가사가 통째로 사라진다.
  const slides: Slide[] = [];
  for (const candidate of parsed) {
    const result = SlideSchema.safeParse(candidate);
    if (result.success) slides.push(result.data);
  }
  return slides;
}

function parseStyle(raw: string | null | undefined): DeckStyle {
  if (!raw) return { ...DEFAULT_DECK_STYLE };
  try {
    const result = DeckStyleSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : { ...DEFAULT_DECK_STYLE };
  } catch {
    return { ...DEFAULT_DECK_STYLE };
  }
}

function toIso(value: Date | number | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  // created_at/updated_at은 DB 기본값이라 Drizzle 타입상 null이 가능하다.
  // 여기서 던지면 행 한 건 때문에 전체 응답이 죽는다.
  return new Date(0).toISOString();
}

function toIsoOrNull(value: Date | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

function toDateOrNull(iso: string | null | undefined): Date | null {
  return iso ? toDate(iso) : null;
}

function toDate(iso: string): Date {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/** D1 덱 행 → 공유 Deck DTO */
export function toSharedDeck(row: DeckRow | NewDeck): SharedDeck {
  return {
    id: row.id as string,
    userId: row.userId as string,
    catalogId: row.catalogId ?? null,
    scope: (row.scope ?? "library") as SharedDeck["scope"],
    presentationId: row.presentationId ?? null,
    title: row.title as string,
    artist: row.artist ?? "",
    lyricsRaw: row.lyricsRaw as string,
    slides: parseSlides(row.slides as string | null),
    backgroundId: row.backgroundId ?? null,
    style: parseStyle(row.style as string | null),
    visibility: (row.visibility ?? "private") as SharedDeck["visibility"],
    forkedFrom: row.forkedFrom ?? null,
    forkCount: row.forkCount ?? 0,
    contributeToCatalog: row.contributeToCatalog ?? false,
    origin: (row.origin ?? "user") as NonNullable<SharedDeck["origin"]>,
    forkedFromAuthorName: row.forkedFromAuthorName ?? null,
    publishedAt: toIsoOrNull(row.publishedAt),
    takedownAt: toIsoOrNull(row.takedownAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** 공유 Deck DTO → D1 덱 행 */
export function toDeckRow(deck: SharedDeck): NewDeck {
  return {
    id: deck.id,
    userId: deck.userId,
    catalogId: deck.catalogId ?? null,
    scope: deck.scope,
    presentationId: deck.presentationId ?? null,
    title: deck.title,
    artist: deck.artist,
    lyricsRaw: deck.lyricsRaw,
    slides: JSON.stringify(deck.slides),
    backgroundId: deck.backgroundId ?? null,
    style: JSON.stringify(deck.style),
    visibility: deck.visibility,
    forkedFrom: deck.forkedFrom ?? null,
    forkCount: deck.forkCount,
    contributeToCatalog: deck.contributeToCatalog ?? false,
    origin: deck.origin ?? "user",
    forkedFromAuthorName: deck.forkedFromAuthorName ?? null,
    publishedAt: toDateOrNull(deck.publishedAt),
    takedownAt: toDateOrNull(deck.takedownAt),
    createdAt: toDate(deck.createdAt),
    updatedAt: toDate(deck.updatedAt),
  };
}

/** 헤더 행 + 조인된 (항목, 덱) 쌍 → 하이드레이션된 문서 */
export function toPresentationDocument(
  presentation: PresentationRow | NewPresentation,
  rows: Array<{
    item: PresentationItemRow | NewPresentationItem;
    deck: DeckRow | NewDeck;
  }>,
): PresentationDocument {
  return {
    id: presentation.id as string,
    userId: presentation.userId as string,
    title: presentation.title as string,
    serviceDate: presentation.serviceDate as string,
    items: rows.map(({ item, deck }) => ({
      id: item.id as string,
      presentationId: item.presentationId as string,
      deckId: item.deckId as string,
      order: item.order as number,
      deck: toSharedDeck(deck),
    })),
    createdAt: toIso(presentation.createdAt),
    updatedAt: toIso(presentation.updatedAt),
  };
}

export interface DecomposedDocument {
  presentation: NewPresentation;
  items: NewPresentationItem[];
  decks: NewDeck[];
}

/**
 * 하이드레이션된 문서 → 정규화된 행들.
 *
 * 항목의 `userId`·`scope`·`presentationId`는 문서 헤더 기준으로 덮어쓴다.
 * 본문이 보내온 값을 그대로 믿으면 남의 계정으로 문서를 심거나, 보관함 덱을
 * 프레젠테이션 덱으로 둔갑시킬 수 있다.
 *
 * 세트 복제본은 공유 대상이 아니다 (M5). 공개·가져간 횟수·게시 기록·기여 여부를
 * 강제로 끈다 — 그러지 않으면 공개 곡을 세트에 담은 복제본이 공개 검색에 섞인다.
 * `forkedFrom`(복제해 온 보관함 덱)과 `forkedFromAuthorName`(원작 표시)은 편집기가
 * 쓰는 값이라 그대로 둔다.
 */
export function fromPresentationDocument(
  doc: PresentationDocument,
): DecomposedDocument {
  const ordered = [...doc.items].sort((a, b) => a.order - b.order);

  return {
    presentation: {
      id: doc.id,
      userId: doc.userId,
      title: doc.title,
      serviceDate: doc.serviceDate,
      createdAt: toDate(doc.createdAt),
      updatedAt: toDate(doc.updatedAt),
    },
    items: ordered.map((item, index) => ({
      id: item.id,
      presentationId: doc.id,
      deckId: item.deck.id,
      order: index,
    })),
    decks: ordered.map((item) =>
      toDeckRow({
        ...item.deck,
        userId: doc.userId,
        scope: "presentation",
        presentationId: doc.id,
        visibility: "private",
        forkCount: 0,
        contributeToCatalog: false,
        publishedAt: null,
        takedownAt: null,
      }),
    ),
  };
}
