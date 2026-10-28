import { beforeEach, describe, expect, it } from "vitest";
import type { Deck, Presentation } from "#shared";
import { SEED_PRESENTATIONS } from "../../test/presentationFixture";
import {
  __resetLineageForTests,
  confirmVersion,
  contentFingerprint,
  forgetLineage,
  isKnownAncestor,
  noteOwnVersion,
  resetLineage,
} from "./presentationLineage";

const SOURCE = SEED_PRESENTATIONS[0];
const FOLDER = "f00000000000000000001";
const BACKGROUND = "b00000000000000000001";
const LATER = "2026-10-01T09:00:00.000Z";

function withDeck(
  doc: Presentation,
  index: number,
  changes: Partial<Deck>,
): Presentation {
  return {
    ...doc,
    items: doc.items.map((item, i) =>
      i === index && item.deck
        ? { ...item, deck: { ...item.deck, ...changes } }
        : item,
    ),
  };
}

function reversedKeys<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).reverse()) as T;
}

function titled(title: string): Presentation {
  return { ...SOURCE, title, updatedAt: LATER };
}

describe("contentFingerprint", () => {
  const fingerprint = contentFingerprint(SOURCE);

  it("수정 시각·기준 판·키 순서·곡 시각·출처 곡은 보지 않는다", () => {
    expect(
      contentFingerprint({
        ...SOURCE,
        createdAt: LATER,
        updatedAt: LATER,
        baseUpdatedAt: LATER,
      }),
    ).toBe(fingerprint);
    expect(contentFingerprint(reversedKeys(SOURCE))).toBe(fingerprint);
    expect(
      contentFingerprint(
        withDeck(SOURCE, 0, {
          createdAt: LATER,
          updatedAt: LATER,
          forkedFrom: "c00000000000000000001",
          forkCount: 3,
          visibility: "public",
          origin: "fork",
          forkedFromAuthorName: "원작자",
        }),
      ),
    ).toBe(fingerprint);
  });

  it("없는 폴더·휴지통·배경은 비어 있는 값과 같게 본다", () => {
    expect(
      contentFingerprint({ ...SOURCE, folderId: null, trashedAt: null }),
    ).toBe(fingerprint);
  });

  it("서버가 한도로 줄이는 긴 제목은 줄인 제목과 같게 본다", () => {
    const long = "가".repeat(150);

    expect(contentFingerprint({ ...SOURCE, title: long })).toBe(
      contentFingerprint({ ...SOURCE, title: "가".repeat(100) }),
    );
  });

  it("제목·예배 날짜·폴더·휴지통이 바뀌면 달라진다", () => {
    expect(contentFingerprint({ ...SOURCE, title: "새 제목" })).not.toBe(
      fingerprint,
    );
    expect(
      contentFingerprint({ ...SOURCE, serviceDate: "2026-10-04" }),
    ).not.toBe(fingerprint);
    expect(contentFingerprint({ ...SOURCE, folderId: FOLDER })).not.toBe(
      fingerprint,
    );
    expect(contentFingerprint({ ...SOURCE, trashedAt: LATER })).not.toBe(
      fingerprint,
    );
  });

  it("곡 순서·항목 id·덱 id가 바뀌면 달라진다", () => {
    const [first, second, ...rest] = SOURCE.items;

    expect(
      contentFingerprint({
        ...SOURCE,
        items: [{ ...second, order: 0 }, { ...first, order: 1 }, ...rest],
      }),
    ).not.toBe(fingerprint);
    expect(
      contentFingerprint({
        ...SOURCE,
        items: [{ ...first, id: "3x0000000000000000001" }, second, ...rest],
      }),
    ).not.toBe(fingerprint);
    expect(
      contentFingerprint(withDeck(SOURCE, 0, { id: "2x0000000000000000001" })),
    ).not.toBe(fingerprint);
  });

  it("가사·슬라이드 줄·서식·배경이 바뀌면 달라진다", () => {
    const deck = SOURCE.items[0].deck!;

    expect(
      contentFingerprint(withDeck(SOURCE, 0, { lyricsRaw: "고친 가사" })),
    ).not.toBe(fingerprint);
    expect(
      contentFingerprint(
        withDeck(SOURCE, 0, {
          slides: deck.slides.map((slide, index) =>
            index === 0 ? { ...slide, lines: ["고친 줄"] } : slide,
          ),
        }),
      ),
    ).not.toBe(fingerprint);
    expect(
      contentFingerprint(
        withDeck(SOURCE, 0, { style: { ...deck.style, fontSizeVw: 8 } }),
      ),
    ).not.toBe(fingerprint);
    expect(
      contentFingerprint(withDeck(SOURCE, 0, { backgroundId: BACKGROUND })),
    ).not.toBe(fingerprint);
  });

  it("슬라이드 순서 번호가 아니라 슬라이드가 놓인 차례를 본다", () => {
    const deck = SOURCE.items[0].deck!;

    expect(
      contentFingerprint(
        withDeck(SOURCE, 0, {
          slides: deck.slides.map((slide) => ({
            ...slide,
            order: slide.order * 10,
          })),
        }),
      ),
    ).toBe(fingerprint);
    expect(
      contentFingerprint(
        withDeck(SOURCE, 0, {
          slides: deck.slides.map((slide) => ({
            ...slide,
            order: deck.slides.length - slide.order,
          })),
        }),
      ),
    ).not.toBe(fingerprint);
  });

  it("빼기로 정하지 않은 필드는 새로 생긴 필드라도 본다", () => {
    expect(
      contentFingerprint({ ...SOURCE, note: "메모" } as Presentation),
    ).not.toBe(fingerprint);
  });
});

describe("판 계보", () => {
  const id = SOURCE.id;
  const fingerprintOf = (title: string) => contentFingerprint(titled(title));

  beforeEach(() => {
    __resetLineageForTests();
  });

  it("이 탭이 올리거나 저장한 판을 조상으로 알고, 같은 판을 잇달아 적으면 한 번만 남긴다", () => {
    noteOwnVersion(titled("A"));
    noteOwnVersion(titled("A"));
    noteOwnVersion(titled("B"));

    expect(isKnownAncestor(id, fingerprintOf("A"))).toBe(true);
    expect(isKnownAncestor(id, fingerprintOf("B"))).toBe(true);
    expect(isKnownAncestor(id, fingerprintOf("C"))).toBe(false);
    expect(isKnownAncestor("100000000000000000099", fingerprintOf("A"))).toBe(
      false,
    );
  });

  it("최근 20개 판만 기억한다", () => {
    for (let n = 0; n < 21; n++) noteOwnVersion(titled(`판 ${n}`));

    expect(isKnownAncestor(id, fingerprintOf("판 0"))).toBe(false);
    expect(isKnownAncestor(id, fingerprintOf("판 1"))).toBe(true);
    expect(isKnownAncestor(id, fingerprintOf("판 20"))).toBe(true);
  });

  it("밖에서 바꾼 판으로 계보를 새로 시작한다", () => {
    noteOwnVersion(titled("A"));
    noteOwnVersion(titled("B"));

    resetLineage(titled("다른 탭의 판"));

    expect(isKnownAncestor(id, fingerprintOf("A"))).toBe(false);
    expect(isKnownAncestor(id, fingerprintOf("B"))).toBe(false);
    expect(isKnownAncestor(id, fingerprintOf("다른 탭의 판"))).toBe(true);
  });

  it("서버가 확정한 판부터 남기고 그 앞의 판은 버린다", () => {
    noteOwnVersion(titled("A"));
    noteOwnVersion(titled("X"));
    noteOwnVersion(titled("Y"));

    confirmVersion(titled("X"));

    expect(isKnownAncestor(id, fingerprintOf("A"))).toBe(false);
    expect(isKnownAncestor(id, fingerprintOf("X"))).toBe(true);
    expect(isKnownAncestor(id, fingerprintOf("Y"))).toBe(true);
  });

  it("X를 확정한 뒤에는 다른 기기가 되돌린 더 앞선 판을 조상으로 보지 않는다 (ABA)", () => {
    noteOwnVersion(titled("A"));
    noteOwnVersion(titled("X"));
    confirmVersion(titled("X"));
    noteOwnVersion(titled("X에서 고친 판"));

    expect(isKnownAncestor(id, fingerprintOf("A"))).toBe(false);
  });

  it("모르는 판을 확정하면 그 판에서 새로 시작한다", () => {
    noteOwnVersion(titled("A"));

    confirmVersion(titled("서버가 받은 판"));

    expect(isKnownAncestor(id, fingerprintOf("A"))).toBe(false);
    expect(isKnownAncestor(id, fingerprintOf("서버가 받은 판"))).toBe(true);
  });

  it("지운 세트의 계보를 잊는다", () => {
    noteOwnVersion(titled("A"));

    forgetLineage(id);

    expect(isKnownAncestor(id, fingerprintOf("A"))).toBe(false);
  });
});
