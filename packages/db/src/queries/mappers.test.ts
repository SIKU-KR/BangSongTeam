import { describe, it, expect } from "vitest";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  PresentationDocumentSchema,
  type Deck as SharedDeck,
  type PresentationDocument,
} from "@repo/shared";
import {
  toSharedDeck,
  toDeckRow,
  toPresentationDocument,
  fromPresentationDocument,
} from "./mappers";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PRESENTATION_ID = "10000000-0000-4000-8000-000000000001";
const DECK_ID = "c0000000-0000-4000-8000-000000000001";
const ITEM_ID = "30000000-0000-4000-8000-000000000001";

function makeSharedDeck(overrides: Partial<SharedDeck> = {}): SharedDeck {
  return DeckSchema.parse({
    id: DECK_ID,
    userId: USER_ID,
    scope: "presentation",
    presentationId: PRESENTATION_ID,
    title: "은혜로다",
    artist: "예수전도단",
    lyricsRaw: "시작됐네\n\n나의 삶을",
    slides: [
      { id: "s1", order: 0, lines: ["시작됐네"] },
      { id: "s2", order: 1, lines: ["나의 삶을"] },
    ],
    backgroundId: "b0000000-0000-0000-0000-000000000001",
    style: { ...DEFAULT_DECK_STYLE, overlayOpacity: 75 },
    visibility: "private",
    forkedFrom: null,
    forkCount: 0,
    origin: "user",
    forkedFromAuthorName: null,
    publishedAt: null,
    takedownAt: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

function makeDocument(): PresentationDocument {
  return PresentationDocumentSchema.parse({
    id: PRESENTATION_ID,
    userId: USER_ID,
    title: "주일 1부 예배",
    serviceDate: "2026-09-27",
    items: [
      {
        id: ITEM_ID,
        presentationId: PRESENTATION_ID,
        deckId: DECK_ID,
        order: 0,
        deck: makeSharedDeck(),
      },
    ],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

describe("행 ↔ DTO 매퍼", () => {
  describe("덱", () => {
    it("왕복해도 값이 보존된다", () => {
      const original = makeSharedDeck();
      const restored = toSharedDeck(toDeckRow(original));
      expect(restored).toEqual(original);
    });

    it("JSON TEXT 컬럼으로 직렬화한다", () => {
      const row = toDeckRow(makeSharedDeck());
      expect(typeof row.slides).toBe("string");
      expect(typeof row.style).toBe("string");
      expect(JSON.parse(row.slides as string)).toHaveLength(2);
    });

    it("타임스탬프를 Date로 넣고 ISO 문자열로 되읽는다", () => {
      const row = toDeckRow(makeSharedDeck());
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(toSharedDeck(row).createdAt).toBe("2026-09-20T00:00:00.000Z");
    });

    it("타임스탬프가 비어 있어도 유효한 덱을 만든다", () => {
      // created_at/updated_at은 DB 기본값(unixepoch())이라 Drizzle 타입상 null이 가능하다.
      // 여기서 던지면 목록 조회 한 건 때문에 전체 응답이 죽는다.
      const row = {
        ...toDeckRow(makeSharedDeck()),
        createdAt: null,
        updatedAt: null,
      };
      const deck = toSharedDeck(row);
      expect(DeckSchema.safeParse(deck).success).toBe(true);
    });

    it("슬라이드 JSON이 깨져 있어도 던지지 않고 빈 배열로 복구한다", () => {
      const row = { ...toDeckRow(makeSharedDeck()), slides: "{not json" };
      const deck = toSharedDeck(row);
      expect(deck.slides).toEqual([]);
      expect(DeckSchema.safeParse(deck).success).toBe(true);
    });

    it("스타일 JSON이 깨져 있으면 기본 스타일로 복구한다", () => {
      const row = { ...toDeckRow(makeSharedDeck()), style: "null" };
      const deck = toSharedDeck(row);
      expect(deck.style).toEqual(DEFAULT_DECK_STYLE);
    });

    it("M5 공유 필드를 왕복한다", () => {
      const original = makeSharedDeck({
        scope: "library",
        presentationId: null,
        visibility: "public",
        forkCount: 7,
        origin: "fork",
        forkedFrom: "c0000000-0000-4000-8000-000000000009",
        forkedFromAuthorName: "김찬양",
        publishedAt: "2026-09-22T00:00:00.000Z",
        takedownAt: "2026-09-23T00:00:00.000Z",
      });
      const row = toDeckRow(original);
      expect(row.publishedAt).toBeInstanceOf(Date);
      expect(toSharedDeck(row)).toEqual(original);
    });

    it("M5 이전 행은 공유 필드를 안전한 기본값으로 읽는다", () => {
      const row = {
        ...toDeckRow(makeSharedDeck()),
        origin: undefined,
        publishedAt: undefined,
      };
      const deck = toSharedDeck(row);
      expect(deck.origin).toBe("user");
      expect(deck.publishedAt).toBeNull();
    });

    it("스키마에 맞지 않는 슬라이드 항목은 걸러 낸다", () => {
      const row = {
        ...toDeckRow(makeSharedDeck()),
        slides: JSON.stringify([
          { id: "ok", order: 0, lines: ["한 줄"] },
          { id: "bad", order: "영", lines: "문자열" },
        ]),
      };
      expect(toSharedDeck(row).slides).toHaveLength(1);
    });
  });

  describe("프레젠테이션 문서", () => {
    it("문서를 행으로 분해했다가 되조립해도 같다", () => {
      const doc = makeDocument();
      const { presentation, items, decks } = fromPresentationDocument(doc);
      const restored = toPresentationDocument(
        presentation,
        items.map((item, i) => ({ item, deck: decks[i] })),
      );
      expect(restored).toEqual(doc);
    });

    it("분해 시 항목과 덱에 프레젠테이션 소유자를 강제한다", () => {
      // 본문의 userId를 믿으면 남의 계정으로 문서를 심을 수 있다.
      const doc = makeDocument();
      doc.userId = "99999999-9999-4999-8999-999999999999";
      const { decks } = fromPresentationDocument(doc);
      expect(decks[0].userId).toBe("99999999-9999-4999-8999-999999999999");
    });

    it("분해한 덱은 scope와 presentationId가 고정된다", () => {
      const doc = makeDocument();
      doc.items[0].deck.scope = "library";
      doc.items[0].deck.presentationId = null;

      const { decks } = fromPresentationDocument(doc);
      expect(decks[0].scope).toBe("presentation");
      expect(decks[0].presentationId).toBe(PRESENTATION_ID);
    });

    it("세트 복제본은 공개·가져간 횟수·게시 기록을 강제로 끈다", () => {
      // 공개 곡을 세트에 담은 복제본이 공개 검색에 섞이던 누출 경로 (M5-1 배경)
      const doc = makeDocument();
      doc.items[0].deck = makeSharedDeck({
        visibility: "public",
        forkCount: 999,
        publishedAt: "2026-09-22T00:00:00.000Z",
        forkedFrom: "c0000000-0000-4000-8000-000000000009",
        forkedFromAuthorName: "김찬양",
      });

      const { decks } = fromPresentationDocument(doc);
      expect(decks[0].visibility).toBe("private");
      expect(decks[0].forkCount).toBe(0);
      expect(decks[0].publishedAt).toBeNull();
      // 편집기가 쓰는 출처 정보는 그대로 둔다
      expect(decks[0].forkedFrom).toBe("c0000000-0000-4000-8000-000000000009");
      expect(decks[0].forkedFromAuthorName).toBe("김찬양");
    });

    it("항목 순서를 order 기준으로 정규화한다", () => {
      const doc = makeDocument();
      const second = {
        ...doc.items[0],
        id: "30000000-0000-4000-8000-000000000002",
        deckId: "c0000000-0000-4000-8000-000000000002",
        order: 5,
        deck: makeSharedDeck({ id: "c0000000-0000-4000-8000-000000000002" }),
      };
      doc.items = [second, doc.items[0]];

      const { items } = fromPresentationDocument(doc);
      expect(items.map((i) => i.order)).toEqual([0, 1]);
      expect(items[0].deckId).toBe(DECK_ID);
    });
  });
});
