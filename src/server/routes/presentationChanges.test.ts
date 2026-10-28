import {
  describe,
  it,
  expect,
  afterEach,
  beforeEach,
  vi,
  type MockInstance,
} from "vitest";
import { env } from "../test/env";
import {
  API_ERRORS,
  DEFAULT_DECK_STYLE,
  PresentationDocumentSchema,
  toPresentationChanges,
  type PresentationDocument,
} from "#shared";
import { decksCol } from "#db";
import { clearDb, seedDocs, userDoc } from "../../db/test/fixtures";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";

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
        forkedFrom: null,
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

/** 사본 곡 문서마다 만든·마지막으로 쓴 시각 (다시 썼는지 확인용) */
async function copyTimes(): Promise<
  Map<string, { created: number; updated: number }>
> {
  const snapshot = await decksCol(env.DB)
    .where("presentationId", "==", DOC_ID)
    .get();
  return new Map(
    snapshot.docs.map((doc) => [
      doc.id,
      {
        created: doc.createTime.toMillis(),
        updated: doc.updateTime.toMillis(),
      },
    ]),
  );
}

async function readSet(): Promise<PresentationDocument> {
  const res = await app.request(`/api/presentations/${DOC_ID}`, {}, env);
  return ((await res.json()) as { presentation: PresentationDocument })
    .presentation;
}

async function patch(body: unknown): Promise<Response> {
  return app.request(
    `/api/presentations/${DOC_ID}`,
    request("PATCH", body),
    env,
  );
}

async function put(body: unknown): Promise<Response> {
  return app.request(`/api/presentations/${DOC_ID}`, request("PUT", body), env);
}

function eventLines(
  log: MockInstance,
  event: string,
): Record<string, unknown>[] {
  return log.mock.calls
    .map(([line]) => String(line))
    .filter((line) => line.includes(`"${event}"`))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const STORED_AT = "2026-09-21T00:00:00.000Z";

describe("PATCH /api/presentations/:id (변경분 저장)", () => {
  beforeEach(async () => {
    await clearDb(env.DB);
    await seedDocs(env.DB, {
      users: [
        { id: USER_A, name: "A", createdAt: new Date(), updatedAt: new Date() },
        { id: USER_B, name: "B", createdAt: new Date(), updatedAt: new Date() },
      ].map((row) => userDoc(row)),
    });
    currentUser = USER_A;

    const put = await app.request(
      `/api/presentations/${DOC_ID}`,
      request("PUT", makeSet(USER_A)),
      env,
    );
    expect(put.status).toBe(200);
  });

  it("10곡 세트에서 가사 한 줄을 고치면 덱 1개만 보내고 그 사본 하나만 다시 쓴다", async () => {
    const edited = editOneLine(makeSet(USER_A));
    const changes = toPresentationChanges(
      edited,
      (deck) => deck.id === deckId(4),
    );
    const before = await copyTimes();

    const res = await app.request(
      `/api/presentations/${DOC_ID}`,
      request("PATCH", changes),
      env,
    );

    expect(res.status).toBe(200);
    expect(changes.decks).toHaveLength(1);
    expect(JSON.stringify(changes).length).toBeLessThan(
      JSON.stringify(edited).length / 5,
    );
    const after = await copyTimes();
    expect(
      [...after].filter(([id, t]) => before.get(id)?.updated !== t.updated),
    ).toEqual([[deckId(4), expect.anything()]]);

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
            forkedFromAuthorName: null,
          },
        })),
      }),
    );
  });

  it("문서 전체 PUT도 모든 곡을 지웠다 다시 넣지 않는다", async () => {
    const before = await copyTimes();

    const res = await app.request(
      `/api/presentations/${DOC_ID}`,
      request("PUT", editOneLine(makeSet(USER_A))),
      env,
    );

    expect(res.status).toBe(200);
    const after = await copyTimes();
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [id, times] of after) {
      expect(times.created, id).toBe(before.get(id)?.created);
    }
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

describe("기준 판(baseUpdatedAt)과 영구 삭제한 세트의 저장", () => {
  beforeEach(async () => {
    await clearDb(env.DB);
    await seedDocs(env.DB, {
      users: [userDoc({ id: USER_A, name: "A" })],
    });
    currentUser = USER_A;
    expect(
      (
        await app.request(
          `/api/presentations/${DOC_ID}`,
          request("PUT", makeSet(USER_A)),
          env,
        )
      ).status,
    ).toBe(200);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("기준이 저장된 판과 같으면 200과 서버가 남긴 판을 돌려준다", async () => {
    const res = await patch({
      ...toPresentationChanges(
        editOneLine(makeSet(USER_A)),
        (deck) => deck.id === deckId(4),
      ),
      baseUpdatedAt: STORED_AT,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      updatedAt: "2026-09-22T00:00:00.000Z",
    });
    expect((await readSet()).items[4].deck.lyricsRaw).toMatch(/추가$/);
  });

  it("기준이 낡으면 412와 저장된 판을 돌려주고, 세트는 그대로 둔 채 가사 없이 기록한다", async () => {
    const first = await patch({
      ...toPresentationChanges(
        editOneLine(makeSet(USER_A)),
        (deck) => deck.id === deckId(4),
      ),
      baseUpdatedAt: STORED_AT,
    });
    expect(first.status).toBe(200);
    const stored = await readSet();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await patch({
      ...toPresentationChanges(
        {
          ...makeSet(USER_A),
          title: "낡은 기기의 제목",
          updatedAt: "2026-09-23T00:00:00.000Z",
        },
        () => false,
      ),
      baseUpdatedAt: STORED_AT,
    });

    expect(res.status).toBe(412);
    const body = (await res.json()) as { error: string; presentation: unknown };
    expect(body.error).toBe(API_ERRORS.presentation.conflict);
    expect(
      PresentationDocumentSchema.safeParse(body.presentation).success,
    ).toBe(true);
    expect(body.presentation).toEqual(stored);
    expect(await readSet()).toEqual(stored);
    const lines = eventLines(log, "presentation_save_conflict");
    expect(lines).toEqual([
      expect.objectContaining({
        severity: "INFO",
        presentationId: DOC_ID,
        route: "/api/presentations/:id",
      }),
    ]);
    expect(JSON.stringify(lines)).not.toContain("번 곡");
  });

  it("문서 전체 PUT도 기준 판을 견줘, 맞으면 200과 판을 돌려주고 낡으면 412로 세트를 그대로 둔다", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const first = await put({
      ...editOneLine(makeSet(USER_A)),
      baseUpdatedAt: STORED_AT,
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      ok: true,
      updatedAt: "2026-09-22T00:00:00.000Z",
    });
    const stored = await readSet();
    expect(stored.items[4].deck.lyricsRaw).toMatch(/추가$/);

    const stale = await put({
      ...makeSet(USER_A),
      title: "낡은 기기의 제목",
      updatedAt: "2026-09-23T00:00:00.000Z",
      baseUpdatedAt: STORED_AT,
    });
    expect(stale.status).toBe(412);
    expect(await stale.json()).toEqual({
      error: API_ERRORS.presentation.conflict,
      presentation: stored,
    });
    expect(await readSet()).toEqual(stored);
    expect(eventLines(log, "presentation_save_conflict")).toHaveLength(1);

    const malformed = await put({ ...makeSet(USER_A), baseUpdatedAt: "어제" });
    expect(malformed.status).toBe(400);
    expect(await readSet()).toEqual(stored);
  });

  it("기준 없이 보낸 이전 클라이언트의 옛 시각 PATCH도 200이고 판은 앞으로 간다", async () => {
    const res = await patch(
      toPresentationChanges(
        {
          ...makeSet(USER_A),
          title: "되돌린 제목",
          updatedAt: "2026-09-20T00:00:00.000Z",
        },
        () => false,
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      updatedAt: "2026-09-21T00:00:00.001Z",
    });
    expect(await readSet()).toMatchObject({
      title: "되돌린 제목",
      updatedAt: "2026-09-21T00:00:00.001Z",
    });
  });

  it("영구 삭제한 프레젠테이션에 늦게 온 PATCH·PUT은 410이고 되살리지 않는다", async () => {
    const trashedAt = "2026-09-22T00:00:00.000Z";
    const trash = await app.request(
      `/api/presentations/${DOC_ID}`,
      request("PUT", { ...makeSet(USER_A), trashedAt, updatedAt: trashedAt }),
      env,
    );
    expect(trash.status).toBe(200);
    const removed = await app.request(
      `/api/presentations/${DOC_ID}`,
      { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } },
      env,
    );
    expect(removed.status).toBe(200);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const late = [
      await patch(
        toPresentationChanges(
          editOneLine(makeSet(USER_A)),
          (deck) => deck.id === deckId(4),
        ),
      ),
      await patch({
        ...toPresentationChanges(editOneLine(makeSet(USER_A))),
        baseUpdatedAt: trashedAt,
      }),
      await app.request(
        `/api/presentations/${DOC_ID}`,
        request("PUT", editOneLine(makeSet(USER_A))),
        env,
      ),
    ];

    for (const res of late) {
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({
        error: API_ERRORS.presentation.deleted,
      });
    }
    expect(
      (await app.request(`/api/presentations/${DOC_ID}`, {}, env)).status,
    ).toBe(404);
    const folders = (await (
      await app.request("/api/folders", {}, env)
    ).json()) as { tombstones: { presentationIds: string[] } };
    expect(folders.tombstones.presentationIds).toEqual([DOC_ID]);
    expect(eventLines(log, "presentation_save_deleted")).toEqual(
      late.map(() =>
        expect.objectContaining({ severity: "INFO", presentationId: DOC_ID }),
      ),
    );
  });
});
