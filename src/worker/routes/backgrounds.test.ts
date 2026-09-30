import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { inArray } from "drizzle-orm";
import {
  BackgroundDeleteResponseSchema,
  BackgroundListResponseSchema,
  DEFAULT_DECK_STYLE,
  DeckSchema,
  type Deck,
} from "#shared";
import { createD1Client, decks, user } from "#db";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";
import { insertUserBackgroundRow, resetBackgrounds } from "../test/backgrounds";

const ADMIN = "aaaaaaaa5000000000001";
const MEMBER = "bbbbbbbb5000000000002";
const LEGACY_UPLOAD = "othr50000000000000001";
const MEDIA_PREFIXES = ["loops/", "posters/", "stills/"];

const testEnv = { ...env, ADMIN_USER_IDS: ADMIN };

let currentUser: string | null = ADMIN;
const fakeSession: SessionReader = async () =>
  currentUser ? { userId: currentUser } : null;
const app = createApp({ readSession: fakeSession });

async function list() {
  const res = await app.request("/api/backgrounds", {}, testEnv);
  expect(res.status).toBe(200);
  return BackgroundListResponseSchema.parse(await res.json());
}

async function mediaKeys(): Promise<string[]> {
  const listed = await Promise.all(
    MEDIA_PREFIXES.map((prefix) => env.MEDIA_BUCKET.list({ prefix })),
  );
  return listed
    .flatMap((result) => result.objects.map((object) => object.key))
    .sort();
}

function remove(id: string) {
  return app.request(
    `/api/backgrounds/uploads/${id}`,
    { method: "DELETE" },
    testEnv,
  );
}

function libraryDeck(id: string, backgroundId: string | null): Deck {
  return DeckSchema.parse({
    id,
    userId: ADMIN,
    scope: "library",
    presentationId: null,
    title: "은혜로다",
    artist: "",
    lyricsRaw: "가사",
    slides: [{ id: "s1", order: 0, lines: ["가사"] }],
    backgroundId,
    style: DEFAULT_DECK_STYLE,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

describe("배경 갤러리 API", () => {
  let serviceIds: string[] = [];
  let initialKeys: string[] = [];

  beforeAll(async () => {
    initialKeys = await mediaKeys();
  });

  beforeEach(async () => {
    const db = createD1Client(env.DB);
    await db.delete(decks);
    await db.delete(user).where(inArray(user.id, [ADMIN, MEMBER]));
    await db.insert(user).values([
      {
        id: ADMIN,
        name: "관리자",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: MEMBER,
        name: "회원",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    serviceIds = await resetBackgrounds(2);
    await insertUserBackgroundRow(MEMBER, LEGACY_UPLOAD, 5000);
    currentUser = ADMIN;
  });

  afterEach(async () => {
    const leftover = (await mediaKeys()).filter(
      (key) => !initialKeys.includes(key),
    );
    if (leftover.length > 0) await env.MEDIA_BUCKET.delete(leftover);
  });

  describe("GET /api/backgrounds", () => {
    it("누구에게나 같은 기본 제공 배경 목록을 주고 예전 사용자 업로드는 뺀다", async () => {
      for (const who of [null, MEMBER, ADMIN]) {
        currentUser = who;
        const body = await list();
        expect(body.backgrounds.map((bg) => bg.id)).toEqual(serviceIds);
      }
    });

    it("관리자에게만 관리 권한을 알린다", async () => {
      currentUser = null;
      expect((await list()).canManage).toBe(false);
      currentUser = MEMBER;
      expect((await list()).canManage).toBe(false);
      currentUser = ADMIN;
      expect((await list()).canManage).toBe(true);
    });

    it("ADMIN_USER_IDS가 비어 있으면 아무도 관리하지 못한다", async () => {
      const res = await app.request("/api/backgrounds", {}, env);
      expect(
        BackgroundListResponseSchema.parse(await res.json()).canManage,
      ).toBe(false);
    });
  });

  it("앱에서 배경을 올리는 경로는 없다 (등록은 스크립트로만)", async () => {
    const res = await app.request(
      "/api/backgrounds/uploads",
      { method: "POST", body: new FormData() },
      testEnv,
    );
    expect(res.status).toBe(404);
  });

  describe("DELETE /api/backgrounds/uploads/:id", () => {
    async function storeFiles(id: string): Promise<void> {
      await env.MEDIA_BUCKET.put(`loops/${id}.mp4`, "mp4");
      await env.MEDIA_BUCKET.put(`posters/${id}.webp`, "webp");
    }

    it("배경을 R2와 함께 지우고, 쓰던 곡은 배경 없음이 된다", async () => {
      const id = serviceIds[0];
      await storeFiles(id);
      const put = await app.request(
        "/api/decks/c00000005000000000001",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(libraryDeck("c00000005000000000001", id)),
        },
        testEnv,
      );
      expect(put.status).toBe(200);

      const res = await remove(id);
      expect(res.status).toBe(200);
      expect(BackgroundDeleteResponseSchema.parse(await res.json())).toEqual({
        ok: true,
      });

      expect(await mediaKeys()).toEqual(initialKeys);
      const decks = (await (
        await app.request("/api/decks", {}, testEnv)
      ).json()) as { decks: Deck[] };
      expect(decks.decks[0].backgroundId).toBeNull();
    });

    it("관리자가 아니면 403이고 배경은 그대로다", async () => {
      currentUser = MEMBER;
      expect((await remove(serviceIds[0])).status).toBe(403);
      expect((await list()).backgrounds.map((bg) => bg.id)).toContain(
        serviceIds[0],
      );
    });

    it("배경 id 형식이 아니면 400이다", async () => {
      expect((await remove("not-an-id")).status).toBe(400);
    });

    it("없는 배경이나 예전 사용자 업로드는 404다", async () => {
      expect((await remove("gone50000000000000001")).status).toBe(404);
      expect((await remove(LEGACY_UPLOAD)).status).toBe(404);
    });
  });
});
