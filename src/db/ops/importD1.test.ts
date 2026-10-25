import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import { COLLECTIONS, usersCol } from "../collections";
import { listBackgrounds } from "../queries/backgrounds";
import { getMyLibraryDecks } from "../queries/decks";
import { getDriveTombstones } from "../queries/folders";
import { getPresentationDocumentsByUserId } from "../queries/presentations";
import { getSharedPresentationDocuments } from "../queries/presentationSharing";
import { searchPublicDecks } from "../queries/search";
import { createTestDb } from "../test/fixtures";
import { convertD1Export, writeImportedDocs, type D1Export } from "./importD1";

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
});
