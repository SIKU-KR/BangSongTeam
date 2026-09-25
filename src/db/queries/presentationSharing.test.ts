import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-utils";
import { decks, folders, presentations, user } from "../schema";
import {
  DEFAULT_DECK_STYLE,
  PresentationDocumentSchema,
  type PresentationDocument,
} from "#shared";
import { upsertPresentationDocument } from "./presentations";
import {
  getPresentationDocument,
  getShareSettings,
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
const DECK_ID = "c00000000000000000001";
const FOLDER_ID = "f00000000000000000001";

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
  let db: ReturnType<typeof createTestDb>["db"];

  beforeEach(async () => {
    db = createTestDb().db;
    const now = new Date();
    await db.insert(user).values([
      { id: OWNER, name: "인도자", createdAt: now, updatedAt: now },
      { id: MEMBER, name: "반주자", createdAt: now, updatedAt: now },
      { id: STRANGER, name: "외부인", createdAt: now, updatedAt: now },
    ]);
    await db.insert(folders).values({
      id: FOLDER_ID,
      userId: OWNER,
      name: "9월",
      createdAt: now,
      updatedAt: now,
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
      await db
        .update(presentations)
        .set({ trashedAt: new Date() })
        .where(eq(presentations.id, DOC_ID));

      expect(await resolvePresentationAccess(db, DOC_ID, MEMBER)).toBeNull();
      expect(await joinByToken(db, token, STRANGER)).toBeNull();
      expect(await getSharedPresentationDocuments(db, MEMBER)).toEqual([]);
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
      expect(single?.folderId).toBeNull();
      expect(single?.access?.ownerName).toBe("인도자");
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
      const [deck] = await db.select().from(decks).where(eq(decks.id, DECK_ID));
      expect(deck.userId).toBe(OWNER);
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
