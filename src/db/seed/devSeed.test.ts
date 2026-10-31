import { describe, it, expect, beforeEach } from "vitest";
import {
  DEV_USERS,
  DeckSchema,
  ID_PATTERN,
  PresentationDocumentSchema,
} from "#shared";
import type { Db } from "../client";
import {
  backgroundsCol,
  decksCol,
  foldersCol,
  presentationMembersCol,
  signUpQuotaDocId,
  signUpQuotasCol,
  usersCol,
} from "../collections";
import {
  createTestDb,
  deckDoc,
  folderDoc,
  seedDocs,
  userDoc,
} from "../test/fixtures";
import {
  getMyLibraryDecks,
  getPresentationDocumentsByUserId,
  getSharedPresentationDocuments,
  toSharedDeck,
} from "../queries";
import { SEED_SONGS, seedDevData, seedId, type DevSeedInput } from "./devSeed";

const [OWNER, MEMBER, NEWBIE] = DEV_USERS;
const OTHER_USER = "other0000000000000001";
const NOW = new Date("2026-09-30T00:00:00.000Z");

const INPUT: DevSeedInput = {
  backgrounds: ["dawn", "sea"].map((name) => ({
    key: `images/${name}.webp`,
    title: name,
    description: "",
    keywords: [name],
    sizeBytes: 1000,
  })),
};

describe("seedDevData", () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
  });

  it("시드 id는 IdSchema를 통과한다", () => {
    for (const kind of ["deck", "pdeck", "pres", "item", "folder", "bg"]) {
      expect(seedId(kind, 1234)).toMatch(ID_PATTERN);
    }
  });

  it("시드 계정마다 앱 스키마를 통과하는 보관함 곡을 만든다", async () => {
    const summary = await seedDevData(db, INPUT, NOW);
    expect(summary.libraryDecks).toBe(SEED_SONGS.length);

    const [ownerLibrary, memberLibrary] = await Promise.all([
      getMyLibraryDecks(db, OWNER.id),
      getMyLibraryDecks(db, MEMBER.id),
    ]);
    expect(ownerLibrary.length + memberLibrary.length).toBe(SEED_SONGS.length);
    expect(memberLibrary.length).toBeGreaterThan(0);
    for (const row of [...ownerLibrary, ...memberLibrary]) {
      const deck = toSharedDeck(row);
      expect(DeckSchema.safeParse(deck).success).toBe(true);
      expect(deck.slides.length).toBeGreaterThan(1);
    }
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

    const ownerFolders = await foldersCol(db)
      .where("userId", "==", OWNER.id)
      .get();
    expect(ownerFolders.size).toBe(summary.folders);

    expect(summary.shareToken).not.toBeNull();
    const shared = await getSharedPresentationDocuments(db, MEMBER.id);
    expect(shared.map((doc) => doc.access?.ownerName)).toEqual([OWNER.name]);

    const ownerLibraryIds = new Set(
      (await getMyLibraryDecks(db, OWNER.id)).map((deck) => deck.id),
    );
    const copies = ownerDocs.flatMap((doc) => doc.items);
    expect(copies.length).toBeGreaterThan(0);
    for (const item of copies) {
      expect(ownerLibraryIds.has(item.deck.forkedFrom ?? "")).toBe(true);
    }
  });

  it("이미지 배경을 등록하고 곡에 입힌다", async () => {
    const summary = await seedDevData(db, INPUT, NOW);
    expect(summary.backgrounds).toBe(INPUT.backgrounds.length);

    const rows = (await backgroundsCol(db).get()).docs.map((doc) => doc.data());
    expect(rows.map((row) => [row.kind, row.mediaKey, row.posterKey])).toEqual([
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
    const newbie = (await usersCol(db).doc(NEWBIE.id).get()).data();
    expect(newbie?.termsAgreedAt).toBeNull();
  });

  it("다시 돌려도 같은 데이터가 되고 다른 계정은 건드리지 않는다", async () => {
    await seedDocs(db, {
      users: [userDoc({ id: OTHER_USER, name: "다른 사용자" })],
      folders: [
        folderDoc({
          id: "otherfolder0000000001",
          userId: OTHER_USER,
          name: "내 폴더",
        }),
      ],
    });
    const deckIds = async () =>
      (await decksCol(db).get()).docs.map((doc) => doc.id).sort();

    await seedDevData(db, INPUT, NOW);
    const first = await deckIds();
    const firstMembers = (await presentationMembersCol(db).get()).size;

    await seedDevData(db, INPUT, NOW);

    expect(await deckIds()).toEqual(first);
    expect((await presentationMembersCol(db).get()).size).toBe(firstMembers);
    expect((await backgroundsCol(db).get()).size).toBe(
      INPUT.backgrounds.length,
    );
    expect(
      (await foldersCol(db).where("userId", "==", OTHER_USER).get()).size,
    ).toBe(1);
  });

  it("로컬 이메일 가입 하루 한도를 비운다", async () => {
    await signUpQuotasCol(db)
      .doc(signUpQuotaDocId("loopback", "2026-09-30"))
      .set({ day: "2026-09-30", signUps: 20, expiresAt: NOW });

    await seedDevData(db, INPUT, NOW);

    expect((await signUpQuotasCol(db).get()).size).toBe(0);
  });

  it("예전 시드가 만든 공유 라이브러리 계정과 그 곡을 지운다", async () => {
    const retired = "bot-seed-official-lib";
    await seedDocs(db, {
      users: [userDoc({ id: retired })],
      decks: [deckDoc({ id: "retiredlibdeck0000001", userId: retired })],
    });

    await seedDevData(db, INPUT, NOW);

    expect((await usersCol(db).doc(retired).get()).exists).toBe(false);
    expect((await decksCol(db).where("userId", "==", retired).get()).size).toBe(
      0,
    );
    expect((await usersCol(db).get()).size).toBe(DEV_USERS.length);
  });
});
