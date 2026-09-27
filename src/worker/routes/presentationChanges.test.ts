import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { inArray } from "drizzle-orm";
import {
  DEFAULT_DECK_STYLE,
  PresentationDocumentSchema,
  toPresentationChanges,
  type PresentationDocument,
} from "#shared";
import {
  createD1Client,
  decks,
  driveTombstones,
  presentationItems,
  presentations,
  user,
} from "#db";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";
import { clearTables } from "../test/db";
import { meterD1 } from "../test/meteredD1";

const USER_A = "aaaaaaaa0000000000011";
const USER_B = "bbbbbbbb0000000000012";
const DOC_ID = "1000000000000000000cc";
const SONG_COUNT = 10;

let currentUser: string | null = USER_A;
const app = createApp({
  readSession: async () => (currentUser ? { userId: currentUser } : null),
} satisfies { readSession: SessionReader });

function deckId(n: number): string {
  return `d${String(n).padStart(20, "0")}`;
}

function makeSet(userId: string): PresentationDocument {
  return PresentationDocumentSchema.parse({
    id: DOC_ID,
    userId,
    title: "주일 1부 예배",
    serviceDate: "2026-09-27",
    items: Array.from({ length: SONG_COUNT }, (_, n) => ({
      id: `4${String(n).padStart(20, "0")}`,
      presentationId: DOC_ID,
      deckId: deckId(n),
      order: n,
      deck: {
        id: deckId(n),
        userId,
        scope: "presentation",
        presentationId: DOC_ID,
        title: `곡 ${n}`,
        artist: "",
        lyricsRaw: Array.from(
          { length: 20 },
          (_, i) => `${n}번 곡 ${i}줄`,
        ).join("\n"),
        slides: Array.from({ length: 10 }, (_, i) => ({
          id: `s${n}_${i}`,
          order: i,
          lines: [`${n}번 곡 ${i * 2}줄`, `${n}번 곡 ${i * 2 + 1}줄`],
        })),
        backgroundId: null,
        style: DEFAULT_DECK_STYLE,
        visibility: "private",
        forkedFrom: null,
        forkCount: 0,
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      },
    })),
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

function editOneLine(doc: PresentationDocument): PresentationDocument {
  return {
    ...doc,
    updatedAt: "2026-09-22T00:00:00.000Z",
    items: doc.items.map((item, i) =>
      i === 4
        ? {
            ...item,
            deck: { ...item.deck, lyricsRaw: `${item.deck.lyricsRaw}\n추가` },
          }
        : item,
    ),
  };
}

function request(method: "PUT" | "PATCH", body: unknown) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function readSet(): Promise<PresentationDocument> {
  const res = await app.request(`/api/presentations/${DOC_ID}`, {}, env);
  return ((await res.json()) as { presentation: PresentationDocument })
    .presentation;
}

describe("PATCH /api/presentations/:id (변경분 저장)", () => {
  beforeEach(async () => {
    const db = createD1Client(env.DB);
    await clearTables(presentationItems, decks, presentations, driveTombstones);
    await db.delete(user).where(inArray(user.id, [USER_A, USER_B]));
    await db.insert(user).values([
      { id: USER_A, name: "A", createdAt: new Date(), updatedAt: new Date() },
      { id: USER_B, name: "B", createdAt: new Date(), updatedAt: new Date() },
    ]);
    currentUser = USER_A;

    const put = await app.request(
      `/api/presentations/${DOC_ID}`,
      request("PUT", makeSet(USER_A)),
      env,
    );
    expect(put.status).toBe(200);
  });

  it("10곡 세트에서 가사 한 줄을 고치면 덱 1개만 보내고 D1 왕복 2번·10행 미만으로 저장한다", async () => {
    const edited = editOneLine(makeSet(USER_A));
    const changes = toPresentationChanges(
      edited,
      (deck) => deck.id === deckId(4),
    );
    const { db, meter } = meterD1(env.DB);

    const res = await app.request(
      `/api/presentations/${DOC_ID}`,
      request("PATCH", changes),
      { ...env, DB: db },
    );

    expect(res.status).toBe(200);
    expect(changes.decks).toHaveLength(1);
    expect(JSON.stringify(changes).length).toBeLessThan(
      JSON.stringify(edited).length / 5,
    );
    expect(meter.roundTrips).toBeLessThanOrEqual(2);
    expect(meter.rowsWritten).toBeLessThan(10);

    const restored = await readSet();
    expect(restored.items).toHaveLength(SONG_COUNT);
    expect(restored.items[4].deck.lyricsRaw).toMatch(/추가$/);
    expect(restored).toEqual(
      PresentationDocumentSchema.parse({
        ...edited,
        folderId: null,
        trashedAt: null,
        items: edited.items.map((item) => ({
          ...item,
          deck: {
            ...item.deck,
            origin: "user",
            forkedFromAuthorName: null,
            publishedAt: null,
            takedownAt: null,
          },
        })),
      }),
    );
  });

  it("문서 전체 PUT도 모든 곡을 지웠다 다시 넣지 않고 D1 왕복 2번에 끝낸다", async () => {
    const { db, meter } = meterD1(env.DB);

    const res = await app.request(
      `/api/presentations/${DOC_ID}`,
      request("PUT", editOneLine(makeSet(USER_A))),
      { ...env, DB: db },
    );

    expect(res.status).toBe(200);
    expect(meter.roundTrips).toBeLessThanOrEqual(2);
    expect(meter.rowsWritten).toBeLessThanOrEqual(SONG_COUNT + 2);
  });

  it("서버에 없는 곡을 빼고 보내면 409이고 세트는 그대로다", async () => {
    const doc = makeSet(USER_A);
    const extra = {
      ...doc,
      items: [
        ...doc.items,
        {
          ...doc.items[0],
          id: "400000000000000000099",
          deckId: deckId(99),
          order: SONG_COUNT,
          deck: { ...doc.items[0].deck, id: deckId(99) },
        },
      ],
    };

    const res = await app.request(
      `/api/presentations/${DOC_ID}`,
      request(
        "PATCH",
        toPresentationChanges(extra, () => false),
      ),
      env,
    );

    expect(res.status).toBe(409);
    expect((await readSet()).items).toHaveLength(SONG_COUNT);
  });

  it("남의 세트는 변경분으로도 고치지 못한다", async () => {
    currentUser = USER_B;
    const res = await app.request(
      `/api/presentations/${DOC_ID}`,
      request(
        "PATCH",
        toPresentationChanges(
          editOneLine(makeSet(USER_B)),
          (deck) => deck.id === deckId(4),
        ),
      ),
      env,
    );

    expect(res.status).toBe(403);
    currentUser = USER_A;
    expect((await readSet()).items[4].deck.lyricsRaw).not.toMatch(/추가$/);
  });

  it("공유받은 세트(access)는 변경분으로도 저장하지 않는다", async () => {
    const res = await app.request(
      `/api/presentations/${DOC_ID}`,
      request("PATCH", {
        ...toPresentationChanges(makeSet(USER_A)),
        access: { ownerName: "A" },
      }),
      env,
    );

    expect(res.status).toBe(403);
  });

  it("경로와 본문의 id가 다르면 400이다", async () => {
    const res = await app.request(
      "/api/presentations/1000000000000000000dd",
      request("PATCH", toPresentationChanges(makeSet(USER_A))),
      env,
    );

    expect(res.status).toBe(400);
  });

  it("미로그인은 401이다", async () => {
    currentUser = null;
    const res = await app.request(
      `/api/presentations/${DOC_ID}`,
      request("PATCH", toPresentationChanges(makeSet(USER_A))),
      env,
    );

    expect(res.status).toBe(401);
  });
});
