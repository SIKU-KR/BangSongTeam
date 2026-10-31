import { describe, it, expect } from "vitest";
import { DEFAULT_DECK_STYLE } from "../constants";
import { FALLBACK_USER_NAME, UNTITLED_SONG } from "../copy/app";
import { PresentationDocumentSchema } from "../schemas/api";
import { MAX_DECK_TITLE_LENGTH } from "../schemas/deck";
import {
  appendWithinLimit,
  clampText,
  fitDeckText,
  fitPresentationToLimits,
  toDisplayName,
  toWellFormedText,
} from "./fitToLimits";

const OWNER = "00000000x000000000001";
const DOC_ID = "100000000000000000001";
const DECK_ID = "c00000000000000000001";

function validDocument() {
  return PresentationDocumentSchema.parse({
    id: DOC_ID,
    userId: OWNER,
    title: "주일 1부 예배",
    serviceDate: "2026-09-27",
    items: [
      {
        id: "300000000000000000001",
        presentationId: DOC_ID,
        deckId: DECK_ID,
        order: 0,
        deck: {
          id: DECK_ID,
          userId: OWNER,
          scope: "presentation",
          presentationId: DOC_ID,
          title: "은혜로다",
          artist: "손경민",
          lyricsRaw: "은혜로다 주의 은혜",
          slides: [{ id: "s1", order: 0, lines: ["은혜로다 주의 은혜"] }],
          backgroundId: null,
          style: DEFAULT_DECK_STYLE,
          createdAt: "2026-09-20T00:00:00.000Z",
          updatedAt: "2026-09-21T00:00:00.000Z",
        },
      },
    ],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

function withDeck(
  doc: ReturnType<typeof validDocument>,
  deck: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...doc,
    items: doc.items.map((item) => ({
      ...item,
      deck: { ...item.deck, ...deck },
    })),
  };
}

describe("toWellFormedText", () => {
  it("짝을 잃은 서로게이트 반쪽만 U+FFFD로 바꾼다", () => {
    expect(toWellFormedText("가\uD83D나")).toBe("가\uFFFD나");
    expect(toWellFormedText("\uDE4F가")).toBe("\uFFFD가");
    expect(toWellFormedText("😀\uD83D")).toBe("😀\uFFFD");
    expect(toWellFormedText("\uDE00\uD83D")).toBe("\uFFFD\uFFFD");
    expect(toWellFormedText("\uD83D😀\uDE00")).toBe("\uFFFD😀\uFFFD");
  });

  it("짝이 맞는 이모지와 보통 글은 그대로 둔다", () => {
    expect(toWellFormedText("")).toBe("");
    expect(toWellFormedText("은혜로다 🙏 주의 은혜")).toBe(
      "은혜로다 🙏 주의 은혜",
    );
    expect(toWellFormedText("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}")).toBe(
      "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
    );
  });
});

describe("clampText", () => {
  it("한도 안의 글은 그대로 둔다", () => {
    expect(clampText("은혜로다", 100)).toBe("은혜로다");
    expect(clampText("가".repeat(100), 100)).toBe("가".repeat(100));
  });

  it("한도를 넘으면 UTF-16 단위로 잘라 한도에 맞춘다", () => {
    expect(clampText("가".repeat(153), MAX_DECK_TITLE_LENGTH)).toBe(
      "가".repeat(100),
    );
  });

  it("서로게이트 쌍을 반쪽으로 자르지 않는다", () => {
    const clamped = clampText(`${"가".repeat(99)}😀`, 100);

    expect(clamped).toBe("가".repeat(99));
    expect(clamped).toHaveLength(99);
  });
});

describe("toDisplayName", () => {
  it("문자열이 아니거나 비어 있으면 기본 이름을 쓴다", () => {
    for (const raw of [0, null, undefined, { x: 1 }, "", "   "]) {
      expect(toDisplayName(raw)).toBe(FALLBACK_USER_NAME.default);
    }
  });

  it("앞뒤 공백을 떼고 50자로 줄인다", () => {
    expect(toDisplayName("  a  ")).toBe("a");
    expect(toDisplayName("a".repeat(200))).toBe("a".repeat(50));
    expect(toDisplayName("김찬양")).toBe("김찬양");
  });

  it("채움 문자나 폭 없는 문자처럼 보이지 않는 글자뿐이면 기본 이름을 쓴다", () => {
    for (const raw of [
      "\u3164",
      "\u200B",
      "\u115F\u200B",
      "\u1160\uFFA0",
      "\u2060\uFE0F\u2800",
      " \u3164 \u200D ",
    ]) {
      expect(toDisplayName(raw)).toBe(FALLBACK_USER_NAME.default);
    }
  });

  it("뒤따르는 글의 방향을 바꾸는 제어 문자를 뺀다", () => {
    expect(toDisplayName("\u202E관리자")).toBe("관리자");
    expect(toDisplayName("김\u2067찬양\u2069")).toBe("김찬양");
    expect(toDisplayName("\u202E \u2066")).toBe(FALLBACK_USER_NAME.default);
  });

  it("보이는 글자와 함께 있는 이모지 결합 문자는 그대로 둔다", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";

    expect(toDisplayName(`찬양팀 ${family}`)).toBe(`찬양팀 ${family}`);
    expect(toDisplayName("\u200B김찬양")).toBe("\u200B김찬양");
  });

  it("50자로 줄인 뒤 보이는 글자가 남지 않으면 기본 이름을 쓴다", () => {
    expect(toDisplayName(`${"\u3164".repeat(50)}김`)).toBe(
      FALLBACK_USER_NAME.default,
    );
  });
});

describe("fitDeckText", () => {
  it("제목·아티스트·원작자 이름을 스키마 한도로 줄인다", () => {
    expect(
      fitDeckText({
        title: "가".repeat(153),
        artist: "나".repeat(150),
        forkedFromAuthorName: "x".repeat(150),
      }),
    ).toEqual({
      title: "가".repeat(100),
      artist: "나".repeat(100),
      forkedFromAuthorName: "x".repeat(100),
    });
  });

  it("빈 제목이나 문자열이 아닌 값에는 기본값을 쓴다", () => {
    expect(fitDeckText({ title: "", artist: null })).toEqual({
      title: UNTITLED_SONG,
      artist: "",
      forkedFromAuthorName: null,
    });
    expect(
      fitDeckText({ title: 42, artist: 7, forkedFromAuthorName: 12345 }),
    ).toEqual({
      title: UNTITLED_SONG,
      artist: "",
      forkedFromAuthorName: FALLBACK_USER_NAME.default,
    });
  });

  it("원작자 이름이 없으면 키를 빼지 않고 null로 둔다", () => {
    const withoutAuthor = fitDeckText({ title: "은혜로다", artist: "" });
    expect(withoutAuthor).toHaveProperty("forkedFromAuthorName", null);
    expect(
      fitDeckText({
        title: "은혜로다",
        artist: "",
        forkedFromAuthorName: null,
      }).forkedFromAuthorName,
    ).toBeNull();
  });

  it("한도 안의 값은 그대로 돌려준다", () => {
    expect(
      fitDeckText({
        title: "은혜로다",
        artist: "예수전도단",
        forkedFromAuthorName: "김찬양",
      }),
    ).toEqual({
      title: "은혜로다",
      artist: "예수전도단",
      forkedFromAuthorName: "김찬양",
    });
  });
});

describe("appendWithinLimit", () => {
  it("꼬리말을 붙여도 한도를 넘지 않게 앞 글을 줄인다", () => {
    const appended = appendWithinLimit("가".repeat(96), " (사본)", 100);

    expect(appended).toHaveLength(100);
    expect(appended.endsWith(" (사본)")).toBe(true);
  });

  it("한도 안이면 꼬리말만 붙인다", () => {
    expect(appendWithinLimit("주일 1부", " (사본)", 100)).toBe(
      "주일 1부 (사본)",
    );
  });
});

describe("fitPresentationToLimits", () => {
  it("한도 안의 문서는 키를 더하지 않고 그대로 돌려준다", () => {
    const doc = validDocument();

    expect(fitPresentationToLimits(doc)).toStrictEqual(doc);
  });

  it("프레젠테이션 제목과 곡의 제목·아티스트·원작자 이름을 한도로 줄인다", () => {
    const fitted = fitPresentationToLimits(
      withDeck(
        { ...validDocument(), title: "가".repeat(150) },
        {
          title: "나".repeat(153),
          artist: "다".repeat(150),
          forkedFromAuthorName: "x".repeat(150),
        },
      ),
    );

    const parsed = PresentationDocumentSchema.parse(fitted);
    expect(parsed.title).toBe("가".repeat(100));
    expect(parsed.items[0].deck).toMatchObject({
      title: "나".repeat(100),
      artist: "다".repeat(100),
      forkedFromAuthorName: "x".repeat(100),
    });
  });

  it("문자열이 아닌 원작자 이름과 소유자 이름은 기본 이름으로 바꾸고 null은 그대로 둔다", () => {
    const fitted = fitPresentationToLimits({
      ...withDeck(validDocument(), { forkedFromAuthorName: 12345 }),
      access: { ownerName: 0, memberId: OWNER },
    }) as {
      access: { ownerName: string };
      items: { deck: { forkedFromAuthorName: unknown } }[];
    };

    expect(fitted.items[0].deck.forkedFromAuthorName).toBe(
      FALLBACK_USER_NAME.default,
    );
    expect(fitted.access.ownerName).toBe(FALLBACK_USER_NAME.default);

    const withNullAuthor = withDeck(validDocument(), {
      forkedFromAuthorName: null,
    });
    expect(fitPresentationToLimits(withNullAuthor)).toStrictEqual(
      withNullAuthor,
    );
  });

  it("글 한도 밖의 잘못된 값은 고치지 않고 스키마가 거절하게 둔다", () => {
    const doc = validDocument();
    const broken = {
      ...doc,
      serviceDate: "nope",
      items: [{ ...doc.items[0], deck: undefined }],
    };

    expect(fitPresentationToLimits(broken)).toStrictEqual(broken);
    expect(
      PresentationDocumentSchema.safeParse(fitPresentationToLimits(broken))
        .success,
    ).toBe(false);
  });

  it("객체가 아닌 값은 그대로 돌려준다", () => {
    for (const value of [null, undefined, 42, "문서", [1, 2]]) {
      expect(fitPresentationToLimits(value)).toBe(value);
    }
  });
});
