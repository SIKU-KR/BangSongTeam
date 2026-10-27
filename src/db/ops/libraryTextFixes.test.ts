import { describe, it, expect, beforeEach } from "vitest";
import {
  OFFICIAL_LIBRARY_NAME,
  OFFICIAL_LIBRARY_USER_ID,
  OPS_ERRORS,
} from "#shared";
import type { Db } from "../client";
import { decksCol } from "../collections";
import { withDeckIndex } from "../deckIndex";
import { searchPublicDecks } from "../queries/search";
import { createTestDb, deckDoc, seedDocs, userDoc } from "../test/fixtures";
import {
  fixLibraryText,
  libraryTitleCorrector,
  parseLibraryTextFixes,
  type LibraryTextFix,
} from "./libraryTextFixes";

const USER = "00000000000000000000a";
const LOVE = "c00000000000000000001";
const USER_LOVE = "c00000000000000000002";
const SPIRIT = "c00000000000000000003";
const MEDLEY = "c00000000000000000004";
const SEEDED_AT = new Date("2026-08-01T00:00:00.000Z");
const MEDLEY_TITLE = `${"가".repeat(95)} _ 나 _ 다`;

const slides = (...lines: string[]) =>
  JSON.stringify(
    lines.map((line, order) => ({ id: `s${order}`, order, lines: [line] })),
  );

const FIXES: LibraryTextFix[] = [
  { title: "Love &amp; Grace", artist: "천관웅", nextTitle: "Love & Grace" },
  {
    title: "성령이 오셨네",
    artist: "김도현",
    lyrics: { from: "진리&#47504; 영이신", to: "진리의 영이신" },
  },
  {
    title: MEDLEY_TITLE,
    artist: "박종호",
    nextTitle: `${"가".repeat(95)} / 나 / 다`,
  },
  { title: "운영에 없는 곡", artist: "누군가", nextTitle: "운영에 없던 곡" },
];

describe("공식 라이브러리 곡 글 고치기", () => {
  let db: Db;

  const deck = async (id: string) => (await decksCol(db).doc(id).get()).data();

  beforeEach(async () => {
    db = createTestDb();
    const official = {
      userId: OFFICIAL_LIBRARY_USER_ID,
      visibility: "public",
      publishedAt: SEEDED_AT,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    } as const;
    await seedDocs(db, {
      users: [
        userDoc({ id: OFFICIAL_LIBRARY_USER_ID, name: OFFICIAL_LIBRARY_NAME }),
        userDoc({ id: USER }),
      ],
      decks: [
        deckDoc({
          ...official,
          id: LOVE,
          title: "Love &amp; Grace",
          artist: "천관웅",
          lyricsRaw: "주의 사랑",
          slides: slides("주의 사랑"),
        }),
        deckDoc({
          id: USER_LOVE,
          userId: USER,
          title: "Love &amp; Grace",
          artist: "천관웅",
        }),
        deckDoc({
          ...official,
          id: SPIRIT,
          title: "성령이 오셨네",
          artist: "김도현",
          lyricsRaw: "참자유가 있다네\n진리&#47504; 영이신 성령이 오셨네",
          slides: slides(
            "참자유가 있다네",
            "진리&#47504; 영이신 성령이 오셨네",
          ),
        }),
        deckDoc({
          ...official,
          id: MEDLEY,
          title: MEDLEY_TITLE.slice(0, 100),
          artist: "박종호",
          slides: slides("메들리"),
        }),
      ],
    });
  });

  it("미리보기는 고칠 공식 곡과 찾지 못한 항목을 알려 주고 아무것도 바꾸지 않는다", async () => {
    const before = await deck(LOVE);

    const preview = await fixLibraryText(db, FIXES);

    expect(preview.changed).toEqual([
      {
        id: LOVE,
        title: "Love &amp; Grace",
        nextTitle: "Love & Grace",
        lyrics: false,
      },
      {
        id: SPIRIT,
        title: "성령이 오셨네",
        nextTitle: "성령이 오셨네",
        lyrics: true,
      },
      {
        id: MEDLEY,
        title: MEDLEY_TITLE.slice(0, 100),
        nextTitle: `${"가".repeat(95)} / 나 `,
        lyrics: false,
      },
    ]);
    expect(preview.unmatched).toEqual([FIXES[3]]);
    expect(preview.alreadyFixed).toBe(0);
    expect(await deck(LOVE)).toEqual(before);
  });

  it("공식 곡만 고치고 공개 범위·검색 색인을 새 글로 맞춘다", async () => {
    const userDeck = await deck(USER_LOVE);

    await fixLibraryText(db, FIXES, { apply: true });

    const love = await deck(LOVE);
    expect(love).toMatchObject({
      title: "Love & Grace",
      listed: true,
      updatedAt: SEEDED_AT,
    });
    expect(love?.searchGrams).toEqual(withDeckIndex(love!).searchGrams);
    expect(
      (await searchPublicDecks(db, "Love & Grace")).map((row) => row.id),
    ).toEqual([LOVE]);
    expect(await deck(USER_LOVE)).toEqual(userDeck);
    expect((await deck(MEDLEY))?.title).toBe(`${"가".repeat(95)} / 나 `);
  });

  it("가사는 원문과 슬라이드 줄 모두에서 바꾸고 슬라이드 id는 지킨다", async () => {
    await fixLibraryText(db, FIXES, { apply: true });

    const spirit = await deck(SPIRIT);
    expect(spirit?.lyricsRaw).toBe(
      "참자유가 있다네\n진리의 영이신 성령이 오셨네",
    );
    expect(JSON.parse(spirit?.slides ?? "[]")).toEqual([
      { id: "s0", order: 0, lines: ["참자유가 있다네"] },
      { id: "s1", order: 1, lines: ["진리의 영이신 성령이 오셨네"] },
    ]);
    expect(spirit?.searchGrams).toEqual(withDeckIndex(spirit!).searchGrams);
  });

  it("다시 실행하면 고칠 곡이 없고 이미 고친 곡으로 센다", async () => {
    await fixLibraryText(db, FIXES, { apply: true });

    expect(await fixLibraryText(db, FIXES, { apply: true })).toEqual({
      changed: [],
      alreadyFixed: 3,
      unmatched: [FIXES[3]],
    });
  });

  it("목록 형식이 맞지 않으면 쓰기 전에 멈춘다", () => {
    expect(parseLibraryTextFixes(FIXES)).toEqual(FIXES);
    for (const invalid of [
      {},
      [{ title: "곡", artist: "가수" }],
      [{ title: "", artist: "가수", nextTitle: "새 곡" }],
      [{ title: "곡", nextTitle: "새 곡" }],
    ]) {
      expect(() => parseLibraryTextFixes(invalid)).toThrow(
        OPS_ERRORS.libraryFix.invalidFile,
      );
    }
  });
});

describe("시드가 견줄 고친 제목", () => {
  const correct = libraryTitleCorrector(FIXES);

  it("옛 제목은 줄이기 전이든 뒤든 고친 제목으로 바꾼다", () => {
    expect(correct("Love &amp; Grace", "천관웅")).toBe("Love & Grace");
    expect(correct(MEDLEY_TITLE, "박종호")).toBe(FIXES[2]?.nextTitle);
    expect(correct(MEDLEY_TITLE.slice(0, 100), "박종호")).toBe(
      FIXES[2]?.nextTitle,
    );
  });

  it("고친 제목, 다른 아티스트의 같은 제목, 가사만 고치는 곡, 목록에 없는 곡은 그대로 둔다", () => {
    for (const [title, artist] of [
      ["Love & Grace", "천관웅"],
      ["Love &amp; Grace", "다른 가수"],
      ["성령이 오셨네", "김도현"],
      ["목록에 없는 곡", "천관웅"],
    ] as const) {
      expect(correct(title, artist)).toBe(title);
    }
  });
});
