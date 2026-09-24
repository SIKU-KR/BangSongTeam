import { describe, it, expect, beforeEach } from "vitest";
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

const A = "aaaaaaaa5000000000001";
const B = "bbbbbbbb5000000000002";
const OTHERS_UPLOAD = "othr50000000000000001";

let currentUser: string | null = A;
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
    env,
  );
}

async function list() {
  const res = await app.request("/api/backgrounds", {}, env);
  expect(res.status).toBe(200);
  return BackgroundListResponseSchema.parse(await res.json());
}

async function uploadedKeys(ownerId: string): Promise<string[]> {
  const listed = await env.MEDIA_BUCKET.list({ prefix: `uploads/${ownerId}/` });
  return listed.objects.map((object) => object.key).sort();
}

function libraryDeck(id: string, backgroundId: string | null): Deck {
  return DeckSchema.parse({
    id,
    userId: A,
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

describe("배경 라이브러리 API", () => {
  let serviceIds: string[] = [];

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM decks");
    await env.DB.exec(`DELETE FROM user WHERE id IN ('${A}', '${B}')`);
    await createD1Client(env.DB)
      .insert(user)
      .values([
        { id: A, name: "A", createdAt: new Date(), updatedAt: new Date() },
        { id: B, name: "B", createdAt: new Date(), updatedAt: new Date() },
      ]);
    serviceIds = await resetBackgrounds(2);
    await insertUserBackgroundRow(B, OTHERS_UPLOAD, 5000);
    for (const owner of [A, B]) {
      const keys = await uploadedKeys(owner);
      if (keys.length > 0) await env.MEDIA_BUCKET.delete(keys);
    }
    currentUser = A;
  });

  describe("GET /api/backgrounds", () => {
    it("비로그인은 사전 주입 배경만 받는다", async () => {
      currentUser = null;
      const body = await list();
      expect(body.backgrounds.map((bg) => bg.id)).toEqual(serviceIds);
      expect(body.usage).toBeNull();
    });

    it("로그인하면 내 업로드와 사용량이 더해지고 남의 업로드는 보이지 않는다", async () => {
      await insertUserBackgroundRow(A, "mine50000000000000001", 700);
      const body = await list();
      expect(body.backgrounds.map((bg) => bg.id)).toEqual([
        ...serviceIds,
        "mine50000000000000001",
      ]);
      expect(body.usage).toEqual({
        usedBytes: 700,
        limitBytes: BACKGROUND_UPLOAD_LIMITS.maxAccountBytes,
      });
    });
  });

  describe("POST /api/backgrounds/uploads", () => {
    it("영상과 포스터를 R2에 올리고 목록에 내 배경으로 나온다", async () => {
      const res = await upload(uploadForm());
      expect(res.status).toBe(201);
      const { background, usage } = BackgroundUploadResponseSchema.parse(
        await res.json(),
      );

      expect(background).toMatchObject({
        title: "본당 배경",
        source: "user",
        kind: "video",
        durationSec: 12,
        tags: ["잔잔한", "따뜻한"],
        sizeBytes: MP4_BYTES.length + WEBP_BYTES.length,
        mediaUrl: `/api/media/uploads/${A}/${background.id}.mp4`,
        posterUrl: `/api/media/uploads/${A}/${background.id}.poster.webp`,
      });
      expect(usage.usedBytes).toBe(MP4_BYTES.length + WEBP_BYTES.length);

      const video = await env.MEDIA_BUCKET.head(
        `uploads/${A}/${background.id}.mp4`,
      );
      expect(video?.httpMetadata?.contentType).toBe("video/mp4");
      const poster = await env.MEDIA_BUCKET.head(
        `uploads/${A}/${background.id}.poster.webp`,
      );
      expect(poster?.httpMetadata?.contentType).toBe("image/webp");

      const media = await app.request(background.mediaUrl, {}, env);
      expect(media.status).toBe(200);
      expect(media.headers.get("content-type")).toBe("video/mp4");

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
      expect(await uploadedKeys(A)).toEqual([
        `uploads/${A}/${background.id}.png`,
      ]);
    });

    it("로그인하지 않으면 401이다", async () => {
      currentUser = null;
      expect((await upload(uploadForm())).status).toBe(401);
    });

    it("권리 확인 동의가 없으면 이유와 함께 거절한다", async () => {
      const res = await upload(uploadForm({ acceptedRightsNotice: null }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("권리");
      expect(await uploadedKeys(A)).toEqual([]);
    });

    it("선언한 형식과 파일 내용이 다르면 거절한다", async () => {
      const res = await upload(
        uploadForm({
          file: new File([PNG_BYTES], "fake.mp4", { type: "video/mp4" }),
        }),
      );
      expect(res.status).toBe(400);
      expect(await uploadedKeys(A)).toEqual([]);
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
      expect(await uploadedKeys(A)).toEqual([]);
    });

    it("계정 300MB를 넘기면 413으로 거절하고 R2에 아무것도 남기지 않는다", async () => {
      await insertUserBackgroundRow(
        A,
        "full50000000000000001",
        BACKGROUND_UPLOAD_LIMITS.maxAccountBytes - 5,
      );
      const res = await upload(uploadForm());
      expect(res.status).toBe(413);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("300MB");
      expect(await uploadedKeys(A)).toEqual([]);
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

    it("내 배경을 R2와 함께 지우고, 쓰던 곡은 배경 없음이 된다", async () => {
      const id = await uploadOne();
      const put = await app.request(
        "/api/decks/c00000005000000000001",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(libraryDeck("c00000005000000000001", id)),
        },
        env,
      );
      expect(put.status).toBe(200);

      const res = await app.request(
        `/api/backgrounds/uploads/${id}`,
        { method: "DELETE" },
        env,
      );
      expect(res.status).toBe(200);
      expect(
        BackgroundDeleteResponseSchema.parse(await res.json()).usage,
      ).toMatchObject({ usedBytes: 0 });

      expect(await uploadedKeys(A)).toEqual([]);
      const decks = (await (
        await app.request("/api/decks", {}, env)
      ).json()) as { decks: Deck[] };
      expect(decks.decks[0].backgroundId).toBeNull();
    });

    it("배경 id 형식이 아니면 400이다", async () => {
      const res = await app.request(
        "/api/backgrounds/uploads/not-an-id",
        { method: "DELETE" },
        env,
      );
      expect(res.status).toBe(400);
    });

    it("남의 업로드와 사전 주입 배경은 지우지 못한다", async () => {
      for (const id of [OTHERS_UPLOAD, serviceIds[0]]) {
        const res = await app.request(
          `/api/backgrounds/uploads/${id}`,
          { method: "DELETE" },
          env,
        );
        expect(res.status).toBe(404);
      }
      currentUser = B;
      expect((await list()).backgrounds.map((bg) => bg.id)).toContain(
        OTHERS_UPLOAD,
      );
    });
  });
});
