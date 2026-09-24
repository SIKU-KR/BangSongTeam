import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import {
  BACKGROUND_UPLOAD_LIMITS,
  BackgroundDeleteResponseSchema,
  BackgroundListResponseSchema,
  BackgroundUploadResponseSchema,
  DEFAULT_DECK_STYLE,
  DeckSchema,
  type Deck,
} from "#shared";
import { createD1Client, user } from "#db";
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

const ascii = (text: string): number[] =>
  [...text].map((char) => char.charCodeAt(0));

const MP4_BYTES = new Uint8Array([0, 0, 0, 0x20, ...ascii("ftypisom"), 1, 2]);
const WEBP_BYTES = new Uint8Array([
  ...ascii("RIFF"),
  0,
  0,
  0,
  0,
  ...ascii("WEBP"),
]);
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
]);

function uploadForm(
  overrides: Partial<Record<string, string | File | null>> = {},
): FormData {
  const fields: Record<string, string | File | null> = {
    file: new File([MP4_BYTES], "loop.mp4", { type: "video/mp4" }),
    poster: new File([WEBP_BYTES], "poster.webp", { type: "image/webp" }),
    title: "본당 배경",
    tags: JSON.stringify(["잔잔한", "따뜻한"]),
    durationSec: "12",
    license: "Pexels License — 홍길동",
    acceptedRightsNotice: "true",
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) form.append(key, value);
  }
  return form;
}

function upload(form: FormData) {
  return app.request(
    "/api/backgrounds/uploads",
    { method: "POST", body: form },
    testEnv,
  );
}

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
    await env.DB.exec("DELETE FROM decks");
    await env.DB.exec(`DELETE FROM user WHERE id IN ('${ADMIN}', '${MEMBER}')`);
    await createD1Client(env.DB)
      .insert(user)
      .values([
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

  describe("POST /api/backgrounds/uploads", () => {
    it("영상과 포스터를 R2에 올리고 모두에게 기본 제공 배경으로 나온다", async () => {
      const res = await upload(uploadForm());
      expect(res.status).toBe(201);
      const { background } = BackgroundUploadResponseSchema.parse(
        await res.json(),
      );

      expect(background).toMatchObject({
        title: "본당 배경",
        source: "service",
        kind: "video",
        license: "Pexels License — 홍길동",
        durationSec: 12,
        tags: ["잔잔한", "따뜻한"],
        sizeBytes: MP4_BYTES.length + WEBP_BYTES.length,
        mediaUrl: `/api/media/loops/${background.id}.mp4`,
        posterUrl: `/api/media/posters/${background.id}.webp`,
      });

      const video = await env.MEDIA_BUCKET.head(`loops/${background.id}.mp4`);
      expect(video?.httpMetadata?.contentType).toBe("video/mp4");
      const poster = await env.MEDIA_BUCKET.head(
        `posters/${background.id}.webp`,
      );
      expect(poster?.httpMetadata?.contentType).toBe("image/webp");

      const media = await app.request(background.mediaUrl, {}, testEnv);
      expect(media.status).toBe(200);
      expect(media.headers.get("content-type")).toBe("video/mp4");

      currentUser = MEMBER;
      expect((await list()).backgrounds.map((bg) => bg.id)).toContain(
        background.id,
      );
    });

    it("이미지는 원본 하나만 올리고 포스터로도 쓴다", async () => {
      const res = await upload(
        uploadForm({
          file: new File([PNG_BYTES], "hall.png", { type: "image/png" }),
          poster: null,
          durationSec: null,
        }),
      );
      expect(res.status).toBe(201);
      const { background } = BackgroundUploadResponseSchema.parse(
        await res.json(),
      );
      expect(background.kind).toBe("image");
      expect(background.durationSec).toBe(0);
      expect(background.posterUrl).toBe(background.mediaUrl);
      expect(await mediaKeys()).toEqual(
        [...initialKeys, `stills/${background.id}.png`].sort(),
      );
    });

    it("로그인하지 않으면 401, 관리자가 아니면 403이다", async () => {
      currentUser = null;
      expect((await upload(uploadForm())).status).toBe(401);
      currentUser = MEMBER;
      const res = await upload(uploadForm());
      expect(res.status).toBe(403);
      expect(await mediaKeys()).toEqual(initialKeys);
    });

    it("출처·라이선스가 없으면 이유와 함께 거절한다", async () => {
      const res = await upload(uploadForm({ license: null }));
      expect(res.status).toBe(400);
      expect(await mediaKeys()).toEqual(initialKeys);
    });

    it("라이선스 확인 동의가 없으면 이유와 함께 거절한다", async () => {
      const res = await upload(uploadForm({ acceptedRightsNotice: null }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("라이선스");
      expect(await mediaKeys()).toEqual(initialKeys);
    });

    it("선언한 형식과 파일 내용이 다르면 거절한다", async () => {
      const res = await upload(
        uploadForm({
          file: new File([PNG_BYTES], "fake.mp4", { type: "video/mp4" }),
        }),
      );
      expect(res.status).toBe(400);
      expect(await mediaKeys()).toEqual(initialKeys);
    });

    it("영상에 포스터가 없으면 거절한다", async () => {
      expect((await upload(uploadForm({ poster: null }))).status).toBe(400);
    });

    it("30MB를 넘는 파일은 거절한다", async () => {
      const big = new Uint8Array(BACKGROUND_UPLOAD_LIMITS.maxFileBytes + 1);
      big.set(MP4_BYTES);
      const res = await upload(
        uploadForm({
          file: new File([big], "big.mp4", { type: "video/mp4" }),
        }),
      );
      expect(res.status).toBe(400);
      expect(await mediaKeys()).toEqual(initialKeys);
    });
  });

  describe("DELETE /api/backgrounds/uploads/:id", () => {
    async function uploadOne(): Promise<string> {
      const res = await upload(uploadForm());
      const { background } = BackgroundUploadResponseSchema.parse(
        await res.json(),
      );
      return background.id;
    }

    it("배경을 R2와 함께 지우고, 쓰던 곡은 배경 없음이 된다", async () => {
      const id = await uploadOne();
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
