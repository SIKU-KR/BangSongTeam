import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DocumentReference,
  Query,
  QuerySnapshot,
  Transaction,
} from "@google-cloud/firestore";
import type { Db } from "../client";
import {
  COLLECTIONS,
  decksCol,
  foldersCol,
  memberDocId,
  presentationMembersCol,
  presentationsCol,
} from "../collections";
import {
  createTestDb,
  folderDoc,
  presentationDoc,
  presentationsWithCopies,
  seedDocs,
  userDoc,
} from "../test/fixtures";
import {
  DEFAULT_DECK_STYLE,
  FALLBACK_USER_NAME,
  PresentationDocumentSchema,
  type PresentationDocument,
} from "#shared";
import { upsertPresentationDocument } from "./presentations";
import {
  getPresentationDocument,
  getShareSettings,
  getSharedDocumentByToken,
  getSharedPresentationDocuments,
  joinByToken,
  resetLinkToken,
  resolvePresentationAccess,
  setLinkAccess,
} from "./presentationSharing";

const OWNER = "000000000000000000001";
const MEMBER = "000000000000000000002";
const STRANGER = "000000000000000000003";
const DOC_ID = "100000000000000000001";
const SECOND_DOC_ID = "100000000000000000002";
const LINK_OFF_DOC_ID = "100000000000000000003";
const TRASHED_DOC_ID = "100000000000000000004";
const DECK_ID = "c00000000000000000001";
const FOLDER_ID = "f00000000000000000001";
const PARENT_FOLDER_ID = "f00000000000000000002";
const OTHER_FOLDER_ID = "f00000000000000000003";
const RESET_WAIT_MS = 300;

afterEach(() => {
  vi.restoreAllMocks();
});

function makeDoc(
  overrides: Partial<PresentationDocument> = {},
): PresentationDocument {
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
          artist: "예수전도단",
          lyricsRaw: "시작됐네",
          slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
          backgroundId: null,
          style: DEFAULT_DECK_STYLE,
          visibility: "private",
          forkedFrom: null,
          forkCount: 0,
          createdAt: "2026-09-20T00:00:00.000Z",
          updatedAt: "2026-09-21T00:00:00.000Z",
        },
      },
    ],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

describe("세트 링크 공유", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [
        userDoc({ id: OWNER, name: "인도자" }),
        userDoc({ id: MEMBER, name: "반주자" }),
        userDoc({ id: STRANGER, name: "외부인" }),
      ],
      folders: [folderDoc({ id: FOLDER_ID, userId: OWNER, name: "9월" })],
    });
    await upsertPresentationDocument(
      db,
      OWNER,
      makeDoc({ folderId: FOLDER_ID }),
    );
  });

  async function shareAndJoin(): Promise<string> {
    const settings = await setLinkAccess(db, DOC_ID, OWNER, "view");
    const token = settings?.token as string;
    await joinByToken(db, token, MEMBER);
    return token;
  }

  async function nestUnderParentFolder(): Promise<void> {
    await seedDocs(db, {
      folders: [
        folderDoc({ id: PARENT_FOLDER_ID, userId: OWNER, name: "2026" }),
        folderDoc({
          id: FOLDER_ID,
          userId: OWNER,
          parentId: PARENT_FOLDER_ID,
          name: "9월",
        }),
      ],
    });
  }

  async function memberExists(userId: string): Promise<boolean> {
    const snapshot = await presentationMembersCol(db)
      .doc(memberDocId(DOC_ID, userId))
      .get();
    return snapshot.exists;
  }

  function isTokenLookup(snapshot: unknown): boolean {
    return (
      snapshot instanceof QuerySnapshot &&
      snapshot.docs[0]?.ref.parent.id === COLLECTIONS.presentations
    );
  }

  function resetAfterFirstTokenLookup(): () => Promise<unknown> {
    let reset: Promise<unknown> | null = null;
    const startReset = async (snapshot: unknown): Promise<void> => {
      if (reset || !isTokenLookup(snapshot)) return;
      reset = resetLinkToken(db, DOC_ID, OWNER);
      await Promise.race([
        reset,
        new Promise((resolve) => setTimeout(resolve, RESET_WAIT_MS)),
      ]);
    };

    const queryGet = Query.prototype.get;
    vi.spyOn(Query.prototype, "get").mockImplementation(async function (
      this: Query,
    ) {
      const snapshot = await queryGet.call(this);
      await startReset(snapshot);
      return snapshot;
    });
    const transactionGet = Transaction.prototype.get as (
      this: Transaction,
      target: unknown,
    ) => Promise<unknown>;
    vi.spyOn(Transaction.prototype, "get").mockImplementation(async function (
      this: Transaction,
      target: unknown,
    ) {
      const snapshot = await transactionGet.call(this, target);
      await startReset(snapshot);
      return snapshot;
    } as typeof Transaction.prototype.get);

    return async () => {
      if (!reset) throw new Error("token lookup never ran");
      return reset;
    };
  }

  describe("in 조건 한도(30)를 넘는 공유 목록", () => {
    it("30개를 넘게 공유받아도 모두 사본 곡과 함께 돌려준다", async () => {
      const seeded = presentationsWithCopies(OWNER, 31, 1, {
        linkAccess: "view",
      });
      await seedDocs(db, {
        ...seeded,
        members: seeded.presentations.map((presentation) => ({
          presentationId: presentation.id,
          userId: MEMBER,
        })),
      });

      const documents = await getSharedPresentationDocuments(db, MEMBER);

      expect(documents.map((document) => document.id).sort()).toEqual(
        seeded.presentations.map((presentation) => presentation.id),
      );
      for (const document of documents) {
        expect(document.access).toEqual({
          ownerName: "인도자",
          memberId: MEMBER,
        });
        expect(document.items).toHaveLength(1);
      }
    });
  });

  describe("설정", () => {
    it("처음에는 링크가 꺼져 있고 토큰이 없다", async () => {
      expect(await getShareSettings(db, DOC_ID, OWNER)).toEqual({
        access: "off",
        token: null,
      });
    });

    it("소유자가 아니면 설정을 읽거나 바꾸지 못한다", async () => {
      expect(await getShareSettings(db, DOC_ID, MEMBER)).toBeNull();
      expect(await setLinkAccess(db, DOC_ID, MEMBER, "view")).toBeNull();
      expect(await resetLinkToken(db, DOC_ID, MEMBER)).toBeNull();
    });

    it("링크를 켜면 토큰을 만들고, 껐다 켜도 같은 토큰을 쓴다", async () => {
      const first = await setLinkAccess(db, DOC_ID, OWNER, "view");
      expect(first?.token).toHaveLength(21);
      await setLinkAccess(db, DOC_ID, OWNER, "off");
      const again = await setLinkAccess(db, DOC_ID, OWNER, "view");
      expect(again?.token).toBe(first?.token);
    });
  });

  describe("접근 판정", () => {
    it("링크가 꺼져 있으면 들어올 수 없다", async () => {
      const token = await shareAndJoin();
      await setLinkAccess(db, DOC_ID, OWNER, "off");
      expect(await joinByToken(db, token, STRANGER)).toBeNull();
    });

    it("들어오면 보기 권한을 받고, 링크를 끄면 잃었다가 다시 켜면 되찾는다", async () => {
      await shareAndJoin();
      expect(await resolvePresentationAccess(db, DOC_ID, MEMBER)).toBe(
        "viewer",
      );

      await setLinkAccess(db, DOC_ID, OWNER, "off");
      expect(await resolvePresentationAccess(db, DOC_ID, MEMBER)).toBeNull();

      await setLinkAccess(db, DOC_ID, OWNER, "view");
      expect(await resolvePresentationAccess(db, DOC_ID, MEMBER)).toBe(
        "viewer",
      );
    });

    it("링크를 받지 않은 사람은 접근하지 못한다", async () => {
      await shareAndJoin();
      expect(await resolvePresentationAccess(db, DOC_ID, STRANGER)).toBeNull();
      expect(await getPresentationDocument(db, DOC_ID, STRANGER)).toBeNull();
    });

    it("소유자는 링크로 열어도 멤버가 되지 않는다", async () => {
      const token = await shareAndJoin();
      const joined = await joinByToken(db, token, OWNER);
      expect(joined?.role).toBe("owner");
      expect(joined?.document.access).toBeUndefined();
      expect(await getSharedPresentationDocuments(db, OWNER)).toEqual([]);
    });

    it("휴지통에 들어간 세트는 링크가 멈춘다", async () => {
      const token = await shareAndJoin();
      await presentationsCol(db).doc(DOC_ID).update({ trashedAt: new Date() });

      expect(await resolvePresentationAccess(db, DOC_ID, MEMBER)).toBeNull();
      expect(await joinByToken(db, token, STRANGER)).toBeNull();
      expect(await getSharedPresentationDocuments(db, MEMBER)).toEqual([]);
    });

    it("휴지통에 넣은 폴더(조상 포함) 안의 프레젠테이션은 링크가 멈추고, 복원하면 다시 열린다", async () => {
      await nestUnderParentFolder();
      const token = await shareAndJoin();

      await foldersCol(db)
        .doc(PARENT_FOLDER_ID)
        .update({ trashedAt: new Date() });

      expect(await resolvePresentationAccess(db, DOC_ID, MEMBER)).toBeNull();
      expect(await getPresentationDocument(db, DOC_ID, MEMBER)).toBeNull();
      expect(await getSharedPresentationDocuments(db, MEMBER)).toEqual([]);
      expect(await getSharedDocumentByToken(db, token)).toBeNull();
      expect(await joinByToken(db, token, STRANGER)).toBeNull();
      expect(await memberExists(STRANGER)).toBe(false);
      expect(await resolvePresentationAccess(db, DOC_ID, OWNER)).toBe("owner");

      await foldersCol(db).doc(PARENT_FOLDER_ID).update({ trashedAt: null });

      expect(await resolvePresentationAccess(db, DOC_ID, MEMBER)).toBe(
        "viewer",
      );
      expect(
        (await getSharedPresentationDocuments(db, MEMBER)).map(
          (document) => document.id,
        ),
      ).toEqual([DOC_ID]);
      expect((await getSharedDocumentByToken(db, token))?.id).toBe(DOC_ID);
      expect(await resolvePresentationAccess(db, DOC_ID, STRANGER)).toBeNull();
    });

    it("링크를 재설정하면 예전 링크와 기존 멤버가 모두 끊긴다", async () => {
      const oldToken = await shareAndJoin();
      const reset = await resetLinkToken(db, DOC_ID, OWNER);

      expect(reset?.token).not.toBe(oldToken);
      expect(await resolvePresentationAccess(db, DOC_ID, MEMBER)).toBeNull();
      expect(await joinByToken(db, oldToken, STRANGER)).toBeNull();
      expect(
        (await joinByToken(db, reset?.token as string, STRANGER))?.role,
      ).toBe("viewer");
    });

    it.each([
      ["이미 들어와 있던", MEMBER],
      ["처음 들어오는", STRANGER],
    ])(
      "%s 사람의 예전 링크 참여가 링크 재설정과 겹쳐도 멤버로 남지 않는다",
      async (_, userId) => {
        const oldToken = await shareAndJoin();
        const resetDone = resetAfterFirstTokenLookup();

        await joinByToken(db, oldToken, userId);
        await resetDone();
        vi.restoreAllMocks();

        expect((await getShareSettings(db, DOC_ID, OWNER))?.token).not.toBe(
          oldToken,
        );
        expect(await memberExists(userId)).toBe(false);
        expect(await resolvePresentationAccess(db, DOC_ID, userId)).toBeNull();
        expect(await getSharedPresentationDocuments(db, userId)).toEqual([]);
      },
    );
  });

  describe("공유 목록의 폴더 읽기", () => {
    it("링크가 살아 있을 수 있는 프레젠테이션의 폴더만 읽고, 같은 조상 폴더는 한 번씩만 읽는다", async () => {
      await nestUnderParentFolder();
      await seedDocs(db, {
        folders: [folderDoc({ id: OTHER_FOLDER_ID, userId: OWNER })],
        presentations: [
          presentationDoc({
            id: SECOND_DOC_ID,
            userId: OWNER,
            folderId: FOLDER_ID,
            linkAccess: "view",
            linkToken: "t00000000000000000002",
          }),
          presentationDoc({
            id: LINK_OFF_DOC_ID,
            userId: OWNER,
            folderId: OTHER_FOLDER_ID,
            linkToken: "t00000000000000000003",
          }),
          presentationDoc({
            id: TRASHED_DOC_ID,
            userId: OWNER,
            folderId: OTHER_FOLDER_ID,
            linkAccess: "view",
            linkToken: "t00000000000000000004",
            trashedAt: new Date(),
          }),
        ],
        members: [SECOND_DOC_ID, LINK_OFF_DOC_ID, TRASHED_DOC_ID].map(
          (presentationId) => ({ presentationId, userId: MEMBER }),
        ),
      });
      await shareAndJoin();
      const get = vi.spyOn(DocumentReference.prototype, "get");

      const documents = await getSharedPresentationDocuments(db, MEMBER);

      const folderReads = (get.mock.contexts as DocumentReference[])
        .filter((ref) => ref.parent.id === COLLECTIONS.folders)
        .map((ref) => ref.id)
        .sort();
      expect(documents.map((document) => document.id).sort()).toEqual([
        DOC_ID,
        SECOND_DOC_ID,
      ]);
      expect(folderReads).toEqual([FOLDER_ID, PARENT_FOLDER_ID]);
    });
  });

  describe("공유받은 문서", () => {
    it("소유자 이름을 붙이고 소유자의 폴더는 감춘다", async () => {
      await shareAndJoin();
      const [shared] = await getSharedPresentationDocuments(db, MEMBER);

      expect(shared.id).toBe(DOC_ID);
      expect(shared.userId).toBe(OWNER);
      expect(shared.folderId).toBeNull();
      expect(shared.access).toEqual({ ownerName: "인도자", memberId: MEMBER });
      expect(shared.items[0].deck.lyricsRaw).toBe("시작됐네");

      const single = await getPresentationDocument(db, DOC_ID, MEMBER);
      expect(single).toMatchObject({
        folderId: null,
        access: { ownerName: "인도자" },
      });
    });

    it("소유자 이름이 문자열이 아니면 기본 이름을 붙인다", async () => {
      await seedDocs(db, {
        users: [{ ...userDoc({ id: OWNER }), name: 0 as unknown as string }],
      });
      await shareAndJoin();

      const [shared] = await getSharedPresentationDocuments(db, MEMBER);
      const single = await getPresentationDocument(db, DOC_ID, MEMBER);

      expect(shared.access?.ownerName).toBe(FALLBACK_USER_NAME.default);
      expect(single?.access?.ownerName).toBe(FALLBACK_USER_NAME.default);
      expect(PresentationDocumentSchema.safeParse(shared).success).toBe(true);
    });

    it("공유받은 사람은 원본을 고치지 못한다", async () => {
      await shareAndJoin();
      expect(
        await upsertPresentationDocument(
          db,
          MEMBER,
          makeDoc({ title: "몰래 수정" }),
        ),
      ).toBe(false);
      expect(
        await upsertPresentationDocument(
          db,
          MEMBER,
          makeDoc({
            title: "몰래 수정",
            access: { ownerName: "인도자", memberId: MEMBER },
          }),
        ),
      ).toBe(false);

      const original = await getPresentationDocument(db, DOC_ID, OWNER);
      expect(original?.title).toBe("주일 1부 예배");
      const deck = (await decksCol(db).doc(DECK_ID).get()).data();
      expect(deck?.userId).toBe(OWNER);
    });

    it("서버에 없는 공유 문서는 되살리지 않는다", async () => {
      expect(
        await upsertPresentationDocument(
          db,
          MEMBER,
          makeDoc({
            id: "100000000000000000009",
            access: { ownerName: "인도자", memberId: MEMBER },
          }),
        ),
      ).toBe(false);
      expect(
        await getPresentationDocument(db, "100000000000000000009", MEMBER),
      ).toBeNull();
    });
  });
});
