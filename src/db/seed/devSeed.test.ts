import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  DEV_USERS,
  DeckSchema,
  ID_PATTERN,
  PresentationDocumentSchema,
} from "#shared";
import { createTestDb } from "../test-utils";
import {
  backgrounds,
  decks,
  folders,
  presentationMembers,
  user,
} from "../schema";
import {
  getMyLibraryDecks,
  getPresentationDocumentsByUserId,
  getSharedPresentationDocuments,
  searchPublicDecks,
  toSharedDeck,
} from "../queries";
import {
  SEED_LIBRARY_USER,
  seedDevData,
  seedId,
  type DevSeedInput,
  type SeedSong,
} from "./devSeed";

const [OWNER, MEMBER, NEWBIE] = DEV_USERS;
const OTHER_USER = "other0000000000000001";
const NOW = new Date("2026-09-30T00:00:00.000Z");

const SONGS: SeedSong[] = Array.from({ length: 60 }, (_, i) => ({
  title: i === 0 ? "가".repeat(150) : `시드 곡 ${i}`,
  artist: i % 2 === 0 ? "새찬송가" : null,
  lyrics: `첫 줄 ${i}\n둘째 줄\n\n셋째 줄\n넷째 줄`,
}));

const INPUT: DevSeedInput = {
  songs: SONGS,
  backgrounds: ["dawn", "sea"].map((name) => ({
    key: `images/${name}.webp`,
    title: name,
    description: "",
    keywords: [name],
    sizeBytes: 1000,
  })),
};

describe("seedDevData", () => {
  let db: ReturnType<typeof createTestDb>["db"];

  beforeEach(() => {
    db = createTestDb().db;
  });

  it("시드 id는 IdSchema를 통과한다", () => {
    for (const kind of [
      "lib",
      "deck",
      "fork",
      "pdeck",
      "pres",
      "item",
      "folder",
      "bg",
    ]) {
      expect(seedId(kind, 1234)).toMatch(ID_PATTERN);
    }
  });

  it("공유 라이브러리 곡을 공개 덱으로 만들고 검색에 올린다", async () => {
    const summary = await seedDevData(db, INPUT, NOW);
    expect(summary.libraryDecks).toBe(SONGS.length);

    const library = await db
      .select()
      .from(decks)
      .where(eq(decks.userId, SEED_LIBRARY_USER.id));
    expect(library).toHaveLength(SONGS.length);
    for (const row of library) {
      expect(DeckSchema.safeParse(toSharedDeck(row)).success).toBe(true);
      expect(row.visibility).toBe("public");
    }

    const found = await searchPublicDecks(db, "시드 곡 7");
    expect(found.map((deck) => deck.title)).toContain("시드 곡 7");
  });

  it("앱 스키마를 통과하는 폴더·세트·공유 상태를 만든다", async () => {
    const summary = await seedDevData(db, INPUT, NOW);

    const ownerDocs = await getPresentationDocumentsByUserId(db, OWNER.id);
    expect(ownerDocs.length).toBeGreaterThan(0);
    for (const doc of ownerDocs) {
      expect(PresentationDocumentSchema.safeParse(doc).success).toBe(true);
    }
    expect(ownerDocs.some((doc) => doc.trashedAt !== null)).toBe(true);
    expect(ownerDocs.some((doc) => doc.folderId !== null)).toBe(true);

    const ownerFolders = await db
      .select()
      .from(folders)
      .where(eq(folders.userId, OWNER.id));
    expect(ownerFolders).toHaveLength(summary.folders);

    expect(summary.shareToken).not.toBeNull();
    const shared = await getSharedPresentationDocuments(db, MEMBER.id);
    expect(shared.map((doc) => doc.access?.ownerName)).toEqual([OWNER.name]);

    const ownerLibrary = await getMyLibraryDecks(db, OWNER.id);
    expect(ownerLibrary.some((deck) => deck.forkedFromAuthorName)).toBe(true);
    expect(ownerLibrary.some((deck) => deck.visibility === "public")).toBe(
      true,
    );
  });

  it("이미지 배경을 등록하고 곡에 입힌다", async () => {
    const summary = await seedDevData(db, INPUT, NOW);
    expect(summary.backgrounds).toBe(INPUT.backgrounds.length);

    const rows = await db.select().from(backgrounds);
    expect(rows.map((row) => [row.kind, row.r2Key, row.posterKey])).toEqual([
      ["image", "images/dawn.webp", "images/dawn.webp"],
      ["image", "images/sea.webp", "images/sea.webp"],
    ]);

    const ownerLibrary = await getMyLibraryDecks(db, OWNER.id);
    const ids = new Set(rows.map((row) => row.id));
    expect(ownerLibrary.some((deck) => ids.has(deck.backgroundId ?? ""))).toBe(
      true,
    );
  });

  it("약관 동의 전 계정을 남겨 동의 모달을 볼 수 있게 한다", async () => {
    await seedDevData(db, INPUT, NOW);
    const [newbie] = await db.select().from(user).where(eq(user.id, NEWBIE.id));
    expect(newbie?.termsAgreedAt).toBeNull();
  });

  it("다시 돌려도 같은 데이터가 되고 다른 계정은 건드리지 않는다", async () => {
    await db.insert(user).values({
      id: OTHER_USER,
      name: "다른 사용자",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(folders).values({
      id: "otherfolder0000000001",
      userId: OTHER_USER,
      parentId: null,
      name: "내 폴더",
      createdAt: NOW,
      updatedAt: NOW,
    });

    await seedDevData(db, INPUT, NOW);
    const first = await db.select({ id: decks.id }).from(decks);
    const firstMembers = await db.select().from(presentationMembers);

    await seedDevData(db, INPUT, NOW);
    const second = await db.select({ id: decks.id }).from(decks);
    const secondMembers = await db.select().from(presentationMembers);

    expect(second.map((d) => d.id).sort()).toEqual(
      first.map((d) => d.id).sort(),
    );
    expect(secondMembers).toHaveLength(firstMembers.length);
    expect(await db.select().from(backgrounds)).toHaveLength(
      INPUT.backgrounds.length,
    );
    expect(
      await db.select().from(folders).where(eq(folders.userId, OTHER_USER)),
    ).toHaveLength(1);
  });

  it("곡이 없으면 아무것도 지우지 않고 멈춘다", async () => {
    await seedDevData(db, INPUT, NOW);
    await expect(
      seedDevData(db, { ...INPUT, songs: [] }, NOW),
    ).rejects.toThrow();
    expect(await db.select().from(user)).toHaveLength(DEV_USERS.length + 1);
  });
});
