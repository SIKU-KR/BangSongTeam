import { describe, it, expect } from "vitest";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  DeckStyleSchema,
  FALLBACK_USER_NAME,
  PresentationDocumentSchema,
  UNTITLED_SONG,
  toPresentationChanges,
  type Deck as SharedDeck,
  type PresentationDocument,
} from "#shared";
import type { DeckDoc, PresentationDoc } from "../collections";
import {
  parseStyle,
  toSharedDeck,
  toDeckContent,
  toFolderDoc,
  toPresentationDocument,
  fromPresentationChanges,
} from "./mappers";

const USER_ID = "00000000x000000000001";
const PRESENTATION_ID = "100000000000000000001";
const DECK_ID = "c00000000000000000001";
const ITEM_ID = "300000000000000000001";

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
    backgroundId: "mJIToShuKOc3FsbZIihi6",
    style: { ...DEFAULT_DECK_STYLE, overlayOpacity: 75 },
    forkedFrom: null,
    forkedFromAuthorName: null,
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

/** 기본값을 채운 곡 문서 */
function asRow(
  row: Pick<DeckDoc, "id" | "userId"> & Partial<DeckDoc>,
): DeckDoc {
  return {
    presentationId: null,
    itemId: null,
    position: null,
    backgroundId: null,
    forkedFrom: null,
    forkedFromAuthorName: null,
    artist: "",
    title: "",
    lyricsRaw: "",
    slides: "[]",
    style: "{}",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...row,
  };
}

/** 공유 Deck DTO를 저장된 행으로 만든다 (보관함 곡이면 소속·자리 없음). */
function toRow(deck: SharedDeck): DeckDoc {
  return asRow({
    id: deck.id,
    userId: deck.userId,
    ...toDeckContent(deck),
    presentationId: deck.presentationId ?? null,
    itemId: deck.presentationId ? ITEM_ID : null,
    position: deck.presentationId ? 0 : null,
    forkedFrom: deck.forkedFrom ?? null,
    forkedFromAuthorName: deck.forkedFromAuthorName ?? null,
  });
}

function reassemble(doc: PresentationDocument): PresentationDocument {
  const { presentation, decks } = fromPresentationChanges(
    toPresentationChanges(doc),
  );
  return toPresentationDocument(
    {
      folderId: null,
      trashedAt: null,
      linkAccess: "off",
      linkToken: null,
      ...presentation,
    } as PresentationDoc,
    decks.map(asRow),
  );
}

describe("문서 ↔ DTO 매퍼", () => {
  describe("덱", () => {
    it("왕복해도 값이 보존된다", () => {
      const original = makeSharedDeck();
      expect(toSharedDeck(toRow(original))).toEqual(original);
    });

    it("JSON TEXT 컬럼으로 직렬화한다", () => {
      const content = toDeckContent(makeSharedDeck());
      expect(typeof content.slides).toBe("string");
      expect(typeof content.style).toBe("string");
      expect(JSON.parse(content.slides)).toHaveLength(2);
    });

    it("타임스탬프를 Date로 넣고 ISO 문자열로 되읽는다", () => {
      const row = toRow(makeSharedDeck());
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(toSharedDeck(row).createdAt).toBe("2026-09-20T00:00:00.000Z");
    });

    it("Firestore가 담지 못하는 0000년 시각은 시각 0으로 낮춘다", () => {
      const content = toDeckContent(
        makeSharedDeck({
          createdAt: "0000-01-01T00:00:00.000Z",
          updatedAt: "0000-12-31T23:59:59.999Z",
        }),
      );

      expect(content.createdAt).toEqual(new Date(0));
      expect(content.updatedAt).toEqual(new Date(0));
      expect(
        toDeckContent(
          makeSharedDeck({ createdAt: "0001-01-01T00:00:00.000Z" }),
        ).createdAt.toISOString(),
      ).toBe("0001-01-01T00:00:00.000Z");
    });

    it("슬라이드 JSON이 깨져 있어도 던지지 않고 빈 배열로 복구한다", () => {
      const row = { ...toRow(makeSharedDeck()), slides: "{not json" };
      const deck = toSharedDeck(row);
      expect(deck.slides).toEqual([]);
      expect(DeckSchema.safeParse(deck).success).toBe(true);
    });

    it("스타일 JSON이 깨져 있으면 기본 스타일로 복구한다", () => {
      const row = { ...toRow(makeSharedDeck()), style: "null" };
      expect(toSharedDeck(row).style).toEqual(DEFAULT_DECK_STYLE);
    });

    it("가져온 곡 정보를 왕복한다", () => {
      const original = makeSharedDeck({
        scope: "library",
        presentationId: null,
        forkedFrom: "c00000000000000000009",
        forkedFromAuthorName: "김찬양",
      });
      expect(toSharedDeck(toRow(original))).toEqual(original);
    });

    it("scope는 저장하지 않고 소속에서 정한다", () => {
      const library = toSharedDeck(
        toRow(makeSharedDeck({ scope: "library", presentationId: null })),
      );
      expect(library.scope).toBe("library");

      const copy = toSharedDeck(toRow(makeSharedDeck()));
      expect(copy.scope).toBe("presentation");
    });

    it("옛 판이 남긴 공유 라이브러리 필드는 응답에 싣지 않는다", () => {
      const deck = toSharedDeck({
        ...toRow(makeSharedDeck()),
        visibility: "public",
        forkCount: 7,
        publishedAt: new Date("2026-09-22T00:00:00.000Z"),
        takedownAt: null,
        listed: true,
        searchGrams: ["은혜"],
      } as DeckDoc);

      expect(deck).toEqual(makeSharedDeck());
    });

    it("스키마에 맞지 않는 슬라이드 항목은 걸러 낸다", () => {
      const row = {
        ...toRow(makeSharedDeck()),
        slides: JSON.stringify([
          { id: "ok", order: 0, lines: ["한 줄"] },
          { id: "bad", order: "영", lines: "문자열" },
        ]),
      };
      expect(toSharedDeck(row).slides).toHaveLength(1);
    });

    it("길이 제한을 넘는 슬라이드는 버리지 않고 제한에 맞게 나눠 읽는다", () => {
      const verse = `${"주 하나님 크신 사랑 ".repeat(8)}찬양하리`;
      const row = {
        ...toRow(makeSharedDeck()),
        slides: JSON.stringify([
          { id: "s1", order: 0, lines: [verse, verse, verse] },
        ]),
      };
      const deck = toSharedDeck(row);
      expect(deck.slides.map((s) => s.id)).toEqual(["s1", "s1_2", "s1_3"]);
      expect(deck.slides.flatMap((s) => s.lines).join(" ")).toBe(
        [verse, verse, verse].join(" "),
      );
      expect(DeckSchema.safeParse(deck).success).toBe(true);
    });

    it("한도를 넘는 제목·아티스트·원작자도 스키마에 맞게 읽는다", () => {
      const deck = toSharedDeck(
        asRow({
          id: DECK_ID,
          userId: USER_ID,
          title: "가".repeat(153),
          artist: "나".repeat(150),
          forkedFromAuthorName: "x".repeat(150),
        }),
      );

      expect(DeckSchema.safeParse(deck).success).toBe(true);
      expect(deck.title).toHaveLength(100);
      expect(deck.artist).toHaveLength(100);
      expect(deck.forkedFromAuthorName).toHaveLength(100);
    });

    it("문자열이 아닌 원작자 이름은 기본 이름으로 읽는다", () => {
      const deck = toSharedDeck({
        ...asRow({ id: DECK_ID, userId: USER_ID, title: "은혜로다" }),
        forkedFromAuthorName: 12345 as unknown as string,
      });

      expect(deck).toMatchObject({
        forkedFromAuthorName: FALLBACK_USER_NAME.default,
      });
      expect(DeckSchema.safeParse(deck).success).toBe(true);
    });

    it("빈 제목은 '(제목 없음)'으로 읽는다", () => {
      const deck = toSharedDeck(
        asRow({ id: DECK_ID, userId: USER_ID, title: "" }),
      );

      expect(deck.title).toBe(UNTITLED_SONG);
      expect(DeckSchema.safeParse(deck).success).toBe(true);
    });

    it("스타일의 한 필드만 틀리면 그 필드만 기본값으로 읽는다", () => {
      const style = parseStyle(
        JSON.stringify({ fontFamily: "NotAFont", fontSizeVw: 6 }),
      );

      expect(style.fontSizeVw).toBe(6);
      expect(style.fontFamily).toBe("Pretendard");
      expect(DeckStyleSchema.safeParse(style).success).toBe(true);
    });

    it("스타일이 객체가 아니거나 JSON이 깨졌으면 기본 스타일로 읽는다", () => {
      expect(parseStyle("[]")).toEqual(DEFAULT_DECK_STYLE);
      expect(parseStyle("not json")).toEqual(DEFAULT_DECK_STYLE);
    });
  });

  describe("프레젠테이션 문서", () => {
    it("문서를 행으로 분해했다가 되조립해도 같다", () => {
      const doc = makeDocument();
      expect(reassemble(doc)).toEqual({
        ...doc,
        folderId: null,
        trashedAt: null,
      });
    });

    it("드라이브 배치(folderId·trashedAt)를 ms까지 왕복한다", () => {
      const doc = {
        ...makeDocument(),
        folderId: "f00000000000000000001",
        trashedAt: "2026-09-24T01:02:03.456Z",
      };
      expect(reassemble(doc)).toEqual(doc);
    });

    it("머리 문서와 폴더의 0000년 시각도 시각 0으로 낮춘다", () => {
      const { presentation } = fromPresentationChanges({
        ...toPresentationChanges(makeDocument()),
        createdAt: "0000-01-01T00:00:00.000Z",
        trashedAt: "0000-06-01T00:00:00.000Z",
      });
      const folder = toFolderDoc({
        id: "f00000000000000000001",
        userId: USER_ID,
        parentId: null,
        name: "폴더",
        trashedAt: null,
        createdAt: "0000-01-01T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      });

      expect(presentation.createdAt).toEqual(new Date(0));
      expect(presentation.trashedAt).toEqual(new Date(0));
      expect(folder.createdAt).toEqual(new Date(0));
      expect(folder.updatedAt.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    });

    it("머리 문서의 제목이 너무 길거나 문자열이 아니어도 문서 스키마에 맞게 읽는다", () => {
      const header: PresentationDoc = {
        id: PRESENTATION_ID,
        userId: USER_ID,
        title: "가".repeat(150),
        serviceDate: "2026-09-27",
        folderId: null,
        trashedAt: null,
        linkAccess: "off",
        linkToken: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };

      const long = toPresentationDocument(header, []);
      const numeric = toPresentationDocument(
        { ...header, title: 42 as unknown as string },
        [],
      );

      expect(PresentationDocumentSchema.safeParse(long).success).toBe(true);
      expect(long.title).toBe("가".repeat(100));
      expect(PresentationDocumentSchema.safeParse(numeric).success).toBe(true);
      expect(numeric.title).toBe(UNTITLED_SONG);
    });

    it("드라이브 필드가 없으면 행에도 넣지 않는다 (업서트가 기존 값을 유지)", () => {
      const { presentation } = fromPresentationChanges(
        toPresentationChanges(makeDocument()),
      );
      expect("folderId" in presentation).toBe(false);
      expect("trashedAt" in presentation).toBe(false);
    });

    it("분해 시 항목과 덱에 프레젠테이션 소유자를 강제한다", () => {
      const doc = makeDocument();
      doc.userId = "999999999999999999999";
      const { decks } = fromPresentationChanges(toPresentationChanges(doc));
      expect(decks[0].userId).toBe("999999999999999999999");
    });

    it("분해한 덱은 소속과 자리가 문서·항목 기준으로 고정된다", () => {
      const doc = makeDocument();
      doc.items[0].deck.scope = "library";
      doc.items[0].deck.presentationId = null;

      const { decks } = fromPresentationChanges(toPresentationChanges(doc));
      expect(decks[0]).toMatchObject({
        presentationId: PRESENTATION_ID,
        itemId: ITEM_ID,
        position: 0,
      });
    });

    it("세트 복제본은 담아 온 곡과 원작 표시를 본문 그대로 둔다", () => {
      const doc = makeDocument();
      doc.items[0].deck = makeSharedDeck({
        forkedFrom: "c00000000000000000009",
        forkedFromAuthorName: "김찬양",
      });

      const { decks } = fromPresentationChanges(toPresentationChanges(doc));
      expect(decks[0].forkedFrom).toBe("c00000000000000000009");
      expect(decks[0].forkedFromAuthorName).toBe("김찬양");
    });

    it("항목 순서를 order 기준으로 정규화한다", () => {
      const doc = makeDocument();
      const second = {
        ...doc.items[0],
        id: "300000000000000000002",
        deckId: "c00000000000000000002",
        order: 5,
        deck: makeSharedDeck({ id: "c00000000000000000002" }),
      };
      doc.items = [second, doc.items[0]];

      const { slots } = fromPresentationChanges(toPresentationChanges(doc));
      expect(slots.map((slot) => slot.position)).toEqual([0, 1]);
      expect(slots[0].deckId).toBe(DECK_ID);
    });
  });
});
