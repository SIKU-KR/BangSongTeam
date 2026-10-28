import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Query } from "@google-cloud/firestore";
import { env } from "../test/env";
import {
  API_ERRORS,
  OmittedPresentationSchema,
  PresentationDocumentSchema,
  type PresentationListEntry,
} from "#shared";
import { COLLECTIONS } from "#db";
import {
  clearDb,
  deckDoc,
  folderDoc,
  presentationDoc,
  seedDocs,
  userDoc,
} from "../../db/test/fixtures";
import { createApp } from "../index";

const OWNER = "aaaaaaaa0000000000031";
const MEMBER = "bbbbbbbb0000000000032";
const FOLDER = "f00000000000000000031";
const OLD = "100000000000000000031";
const CHANGED = "100000000000000000032";
const TRASHED = "100000000000000000033";
const SHARED_OLD = "100000000000000000034";
const SHARED_CHANGED = "100000000000000000035";

const BEFORE = new Date("2026-10-01T00:00:00.000Z");
const SINCE = "2026-10-10T00:00:00.000Z";
const AFTER = new Date("2026-10-20T00:00:00.000Z");

let currentUser: string | null = OWNER;
const app = createApp({
  readSession: async () => (currentUser ? { userId: currentUser } : null),
});

function copies(presentationId: string, userId: string, count: number) {
  const suffix = (position: number) =>
    `${presentationId.slice(-2)}${String(position).padStart(18, "0")}`;
  return Array.from({ length: count }, (_, position) =>
    deckDoc({
      id: `c${suffix(position)}`,
      userId,
      presentationId,
      itemId: `i${suffix(position)}`,
      position,
      title: `곡 ${position}`,
    }),
  );
}

async function list(query = ""): Promise<{
  status: number;
  body: { presentations?: PresentationListEntry[]; error?: string };
}> {
  const res = await app.request(`/api/presentations${query}`, {}, env);
  return { status: res.status, body: await res.json() };
}

function byId(
  entries: readonly PresentationListEntry[] | undefined,
): Map<string, PresentationListEntry> {
  return new Map((entries ?? []).map((entry) => [entry.id, entry]));
}

function countCopyReads(): () => number {
  const original = Query.prototype.get;
  let reads = 0;
  vi.spyOn(Query.prototype, "get").mockImplementation(async function (
    this: Query,
  ) {
    const snapshot = await original.call(this);
    reads += snapshot.docs.filter(
      (doc) => doc.ref.parent.id === COLLECTIONS.decks,
    ).length;
    return snapshot;
  } as typeof Query.prototype.get);
  return () => reads;
}

describe("GET /api/presentations — 바뀐 프레젠테이션만 곡 사본 담기 (since)", () => {
  beforeEach(async () => {
    await clearDb(env.DB);
    currentUser = OWNER;
    await seedDocs(env.DB, {
      users: [
        userDoc({ id: OWNER, name: "찬양 인도자" }),
        userDoc({ id: MEMBER, name: "반주자" }),
      ],
      folders: [folderDoc({ id: FOLDER, userId: OWNER })],
      presentations: [
        presentationDoc({
          id: OLD,
          userId: OWNER,
          title: "지난주 예배",
          folderId: FOLDER,
          createdAt: BEFORE,
          updatedAt: BEFORE,
        }),
        presentationDoc({
          id: CHANGED,
          userId: OWNER,
          title: "이번 주 예배",
          createdAt: BEFORE,
          updatedAt: AFTER,
        }),
        presentationDoc({
          id: TRASHED,
          userId: OWNER,
          title: "지운 예배",
          trashedAt: BEFORE,
          createdAt: BEFORE,
          updatedAt: BEFORE,
        }),
        presentationDoc({
          id: SHARED_OLD,
          userId: MEMBER,
          title: "공유받은 지난 세트",
          linkAccess: "view",
          linkToken: "token-old",
          createdAt: BEFORE,
          updatedAt: BEFORE,
        }),
        presentationDoc({
          id: SHARED_CHANGED,
          userId: MEMBER,
          title: "공유받은 새 세트",
          linkAccess: "view",
          linkToken: "token-new",
          createdAt: BEFORE,
          updatedAt: AFTER,
        }),
      ],
      decks: [
        ...copies(OLD, OWNER, 3),
        ...copies(CHANGED, OWNER, 2),
        ...copies(TRASHED, OWNER, 1),
        ...copies(SHARED_OLD, MEMBER, 2),
        ...copies(SHARED_CHANGED, MEMBER, 1),
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function joinShares(): Promise<void> {
    await seedDocs(env.DB, {
      members: [
        { presentationId: SHARED_OLD, userId: OWNER },
        { presentationId: SHARED_CHANGED, userId: OWNER },
      ],
    });
  }

  it("since 없이 받으면 이전처럼 모든 프레젠테이션에 곡 사본을 담는다", async () => {
    const { status, body } = await list();

    expect(status).toBe(200);
    const entries = byId(body.presentations);
    expect([...entries.keys()].sort()).toEqual([OLD, CHANGED, TRASHED]);
    for (const entry of entries.values()) {
      expect(PresentationDocumentSchema.safeParse(entry).success).toBe(true);
      expect(entry).not.toHaveProperty("copiesOmitted");
    }
    expect(entries.get(OLD)?.items).toHaveLength(3);
  });

  it("since보다 늦게 바뀐 프레젠테이션만 곡을 담고, 나머지는 폴더·휴지통까지 머리를 그대로 보낸다", async () => {
    const { status, body } = await list(`?since=${SINCE}`);

    expect(status).toBe(200);
    const entries = byId(body.presentations);
    expect([...entries.keys()].sort()).toEqual([OLD, CHANGED, TRASHED]);

    const changed = PresentationDocumentSchema.parse(entries.get(CHANGED));
    expect(changed.items.map((item) => item.deck.title)).toEqual([
      "곡 0",
      "곡 1",
    ]);
    expect(entries.get(CHANGED)).not.toHaveProperty("copiesOmitted");

    expect(OmittedPresentationSchema.parse(entries.get(OLD))).toEqual({
      id: OLD,
      userId: OWNER,
      title: "지난주 예배",
      serviceDate: "2026-09-27",
      folderId: FOLDER,
      trashedAt: null,
      createdAt: BEFORE.toISOString(),
      updatedAt: BEFORE.toISOString(),
      items: null,
      copiesOmitted: true,
    });
    expect(OmittedPresentationSchema.parse(entries.get(TRASHED))).toMatchObject(
      { trashedAt: BEFORE.toISOString(), items: null, copiesOmitted: true },
    );
  });

  it("바뀌지 않은 프레젠테이션의 곡 사본은 읽지 않는다", async () => {
    const copyReads = countCopyReads();

    await list(`?since=${SINCE}`);

    expect(copyReads()).toBe(2);
  });

  it("판이 since와 같은 프레젠테이션은 바뀌지 않은 것으로 본다", async () => {
    const { body } = await list(`?since=${AFTER.toISOString()}`);

    expect(
      body.presentations?.every(
        (entry) => "copiesOmitted" in entry && entry.copiesOmitted,
      ),
    ).toBe(true);
  });

  it("링크로 공유받은 프레젠테이션도 since 뒤에 바뀐 것만 곡을 담고, 머리에는 공유 정보만 싣는다", async () => {
    await joinShares();

    const { body } = await list(`?since=${SINCE}`);

    const entries = byId(body.presentations);
    expect(
      PresentationDocumentSchema.parse(entries.get(SHARED_CHANGED)).access,
    ).toEqual({ ownerName: "반주자", memberId: OWNER });
    expect(OmittedPresentationSchema.parse(entries.get(SHARED_OLD))).toEqual({
      id: SHARED_OLD,
      userId: MEMBER,
      title: "공유받은 지난 세트",
      serviceDate: "2026-09-27",
      folderId: null,
      trashedAt: null,
      access: { ownerName: "반주자", memberId: OWNER },
      createdAt: BEFORE.toISOString(),
      updatedAt: BEFORE.toISOString(),
      items: null,
      copiesOmitted: true,
    });
  });

  it("since가 ISO 시각이 아니면 400으로 거절한다", async () => {
    for (const query of [
      "?since=어제",
      "?since=",
      "?since=1727000000000",
      `?since=${SINCE}&since=${SINCE}`,
    ]) {
      const { status, body } = await list(query);
      expect(status, query).toBe(400);
      expect(body).toEqual({ error: API_ERRORS.idMismatch });
    }
  });

  it("로그인하지 않은 요청은 since를 보기 전에 401로 거절한다", async () => {
    currentUser = null;

    const { status } = await list("?since=어제");

    expect(status).toBe(401);
  });
});
