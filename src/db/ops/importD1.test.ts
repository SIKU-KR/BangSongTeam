import { describe, it, expect, beforeEach } from "vitest";
import { DeckSchema, OPS_ERRORS } from "#shared";
import type { Db } from "../client";
import { COLLECTIONS, decksCol, usersCol, type DeckDoc } from "../collections";
import { listBackgrounds } from "../queries/backgrounds";
import { getMyLibraryDecks } from "../queries/decks";
import { toSharedDeck } from "../queries/mappers";
import { getDriveTombstones } from "../queries/folders";
import { getPresentationDocumentsByUserId } from "../queries/presentations";
import { getSharedPresentationDocuments } from "../queries/presentationSharing";
import { searchPublicDecks } from "../queries/search";
import { createTestDb } from "../test/fixtures";
import {
  assertImportTargetEmpty,
  convertD1Export,
  writeImportedDocs,
  type D1Export,
} from "./importD1";
import { takedownDeck } from "./moderation";

const OWNER = "aaaaaaaa0000000000001";
const VIEWER = "bbbbbbbb0000000000002";
const SEC = 1_758_000_000;
const MS = SEC * 1000;

const EXPORT: D1Export = {
  user: [
    {
      id: OWNER,
      name: "인도자",
      email: "lead@example.com",
      email_verified: 1,
      image: null,
      terms_agreed_at: SEC,
      created_at: SEC,
      updated_at: SEC,
    },
    {
      id: VIEWER,
      name: "반주자",
      email: null,
      email_verified: 0,
      image: null,
      terms_agreed_at: null,
      created_at: SEC,
      updated_at: SEC,
    },
  ],
  session: [
    {
      id: "s1",
      user_id: OWNER,
      token: "tok",
      expires_at: SEC + 3600,
      ip_address: null,
      user_agent: "ua",
      created_at: SEC,
      updated_at: SEC,
    },
  ],
  folders: [
    {
      id: "f1",
      user_id: OWNER,
      parent_id: null,
      name: "주일",
      trashed_at: null,
      created_at: MS,
      updated_at: MS,
    },
  ],
  presentations: [
    {
      id: "p1",
      user_id: OWNER,
      title: "주일 예배",
      service_date: "2026-09-27",
      folder_id: "f1",
      trashed_at: null,
      link_access: "view",
      link_token: "link",
      created_at: MS,
      updated_at: MS,
    },
  ],
  decks: [
    {
      id: "d1",
      user_id: OWNER,
      presentation_id: null,
      item_id: null,
      position: null,
      title: "은혜로다",
      artist: "예수전도단",
      lyrics_raw: "시작됐네",
      slides: JSON.stringify([{ id: "s", order: 0, lines: ["시작됐네"] }]),
      style: "{}",
      background_id: "bg1",
      forked_from: null,
      forked_from_author_name: null,
      visibility: "public",
      published_at: MS,
      taken_down_at: null,
      fork_count: 2,
      created_at: MS,
      updated_at: MS,
    },
    {
      id: "c1",
      user_id: OWNER,
      presentation_id: "p1",
      item_id: "i1",
      position: 0,
      title: "은혜로다",
      artist: "",
      lyrics_raw: "시작됐네",
      slides: "[]",
      style: "{}",
      background_id: null,
      forked_from: "d1",
      forked_from_author_name: null,
      visibility: "private",
      published_at: null,
      taken_down_at: null,
      fork_count: 0,
      created_at: MS,
      updated_at: MS,
    },
  ],
  presentation_members: [{ presentation_id: "p1", user_id: VIEWER }],
  drive_tombstones: [{ item_id: "gone", user_id: OWNER, kind: "folder" }],
  backgrounds: [
    {
      id: "bg1",
      title: "노을",
      kind: "video",
      r2_key: "loops/bg1.mp4",
      poster_key: "posters/bg1.webp",
      duration_sec: 20,
      size_bytes: 100,
      license: "",
      description: "따뜻한 노을",
      created_at: MS,
    },
  ],
  background_keywords: [
    { background_id: "bg1", keyword: "노을" },
    { background_id: "bg1", keyword: "주황" },
  ],
};

describe("D1 내보내기 옮기기", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await writeImportedDocs(db, convertD1Export(EXPORT));
  });

  it("인증 테이블의 초 단위 시각과 0/1 값을 바꾼다", async () => {
    const owner = (await usersCol(db).doc(OWNER).get()).data();
    expect(owner).toMatchObject({
      emailVerified: true,
      termsAgreedAt: new Date(MS),
      createdAt: new Date(MS),
    });
    const session = (
      await db.collection(COLLECTIONS.sessions).doc("s1").get()
    ).data();
    expect(session).toMatchObject({ userId: OWNER, token: "tok" });
  });

  it("옮긴 데이터를 앱 쿼리가 그대로 읽는다", async () => {
    const [library] = await getMyLibraryDecks(db, OWNER);
    expect(library).toMatchObject({ id: "d1", forkCount: 2, listed: true });

    const [card] = await searchPublicDecks(db, "은혜");
    expect(card).toMatchObject({ id: "d1", authorName: "인도자" });

    const [doc] = await getPresentationDocumentsByUserId(db, OWNER);
    expect(doc).toMatchObject({ id: "p1", folderId: "f1" });
    expect(doc?.items.map((item) => item.deck.forkedFrom)).toEqual(["d1"]);

    const shared = await getSharedPresentationDocuments(db, VIEWER);
    expect(shared.map((d) => d.access?.ownerName)).toEqual(["인도자"]);

    expect((await getDriveTombstones(db, OWNER)).folderIds).toEqual(["gone"]);

    const [background] = await listBackgrounds(db);
    expect(background).toMatchObject({
      mediaUrl: "/api/media/loops/bg1.mp4",
      keywords: ["노을", "주황"],
    });
  });

  it("제목이 100자를 넘는 메들리처럼 한도를 벗어난 곡도 앱의 덱 스키마로 읽힌다", async () => {
    const medleyDb = createTestDb();
    const [song] = EXPORT.decks ?? [];
    await writeImportedDocs(
      medleyDb,
      convertD1Export({
        user: EXPORT.user,
        decks: [
          {
            ...song,
            id: "dmedley00000000000001",
            background_id: null,
            title: "가".repeat(153),
            artist: "나".repeat(150),
            forked_from_author_name: "x".repeat(150),
            fork_count: -1,
          },
        ],
      }),
    );

    const [medley] = await getMyLibraryDecks(medleyDb, OWNER);
    const deck = toSharedDeck(medley as DeckDoc);

    expect(DeckSchema.safeParse(deck).success).toBe(true);
    expect(deck).toMatchObject({
      title: "가".repeat(100),
      artist: "나".repeat(100),
      forkedFromAuthorName: "x".repeat(100),
      forkCount: 0,
    });
  });

  describe("이미 쓰고 있는 대상", () => {
    const listedD1 = async (): Promise<boolean | undefined> =>
      (await decksCol(db).doc("d1").get()).data()?.listed;

    it("사용자가 있는 대상은 비어 있지 않다고 멈춘다", async () => {
      await expect(assertImportTargetEmpty(db)).rejects.toThrow(
        OPS_ERRORS.importTargetNotEmpty,
      );
    });

    it("비어 있는 대상은 통과한다", async () => {
      await expect(
        assertImportTargetEmpty(createTestDb()),
      ).resolves.toBeUndefined();
    });

    it("다시 옮기면 옮긴 뒤의 게시 중단을 되돌리므로 기본으로는 쓰지 않는다", async () => {
      await takedownDeck(db, "d1");
      expect(await listedD1()).toBe(false);

      await expect(
        writeImportedDocs(db, convertD1Export(EXPORT)),
      ).rejects.toThrow(OPS_ERRORS.importTargetNotEmpty);
      expect(await listedD1()).toBe(false);
    });

    it("overwriteExisting을 주면 롤백 뒤 다시 옮길 때처럼 덮어쓴다", async () => {
      await takedownDeck(db, "d1");

      await writeImportedDocs(db, convertD1Export(EXPORT), {
        overwriteExisting: true,
      });
      expect(await listedD1()).toBe(true);
    });
  });
});
