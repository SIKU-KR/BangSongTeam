import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { env } from "./test/env";
import {
  API_ERRORS,
  BackgroundListResponseSchema,
  DEFAULT_DECK_STYLE,
  DeckSchema,
  type Deck,
} from "#shared";
import app, { createApp } from "./index";
import type { Db } from "#db";
import type { MediaStore } from "./lib/mediaStore";

const SIGNED_IN_USER = "aaaaaaaa00000000000i1";
const LIBRARY_DECK_ID = "c000000000000000000i1";
const FOLDER_ID = "f000000000000000000i1";
const PRESENTATION_ID = "1000000000000000000i1";

const signedInApp = createApp({
  readSession: async () => ({ userId: SIGNED_IN_USER }),
});

function libraryDeck(overrides: Partial<Deck> = {}): Deck {
  return DeckSchema.parse({
    id: LIBRARY_DECK_ID,
    userId: SIGNED_IN_USER,
    scope: "library",
    title: "은혜로다",
    lyricsRaw: "시작됐네",
    slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

function countingJsonArrayBody(totalBytes: number): {
  body: ReadableStream<Uint8Array>;
  pulledBytes: () => number;
} {
  const encoder = new TextEncoder();
  const element = encoder.encode("{},".repeat(5_000));
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const last = pulled >= totalBytes;
      const chunk =
        pulled === 0
          ? encoder.encode("[")
          : last
            ? encoder.encode("{}]")
            : element;
      pulled += chunk.byteLength;
      controller.enqueue(chunk);
      if (last) controller.close();
    },
  });
  return { body, pulledBytes: () => pulled };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API 앱 통합 테스트 (Firestore 에뮬레이터)", () => {
  beforeAll(() => {
    env.MEDIA.put(
      "loops/warm_light_flow.mp4",
      new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      "video/mp4",
    );
  });

  it("GET /api/health returns 200 OK with { status: 'ok' }", async () => {
    const res = await app.request("/api/health", {}, env);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: "ok" });
  });

  it("GET /api/health는 세션 없이 Firestore에 가지 않고 캐시 금지로 답한다", async () => {
    const untouchable = new Proxy(
      {},
      {
        get() {
          throw new Error("health check must not touch Firestore");
        },
      },
    ) as Db;

    const res = await app.request(
      "/api/health",
      {},
      { ...env, DB: untouchable },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("처리되지 않은 오류는 내부 메시지를 숨기고 500을 준다", async () => {
    const brokenStore: MediaStore = {
      stat: async () => {
        throw new Error("GCS internal: bangsongteam-media unreachable");
      },
      read: () => new ReadableStream(),
    };

    const res = await app.request(
      "/api/media/loops/warm_light_flow.mp4",
      {},
      { ...env, MEDIA: brokenStore },
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: API_ERRORS.requestFailed });
  });

  it("저장소 일시 장애는 503과 다시 시도하라는 한국어 문장을 준다", async () => {
    const unavailableStore: MediaStore = {
      stat: async () => {
        throw Object.assign(new Error("unavailable"), { code: 14 });
      },
      read: () => new ReadableStream(),
    };

    const res = await app.request(
      "/api/media/loops/warm_light_flow.mp4",
      {},
      { ...env, MEDIA: unavailableStore },
    );

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).not.toBeNull();
    expect(await res.json()).toEqual({ error: API_ERRORS.serverBusy });
  });

  it("없는 API 경로는 404와 새로고침하라는 한국어 문장을 준다", async () => {
    const res = await app.request("/api/unknown-path", {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: API_ERRORS.notFound });
  });

  it("GET /api/backgrounds는 비로그인에게 기본 제공 배경을 준다", async () => {
    const res = await app.request("/api/backgrounds", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");

    expect(
      BackgroundListResponseSchema.safeParse(await res.json()).success,
    ).toBe(true);
  });

  it("GET /api/media/:key streams the full video with 200 OK", async () => {
    const res = await app.request(
      "/api/media/loops/warm_light_flow.mp4",
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe("10");
    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBe(10);
  });

  it("GET /api/media/:key with Range header returns 206 Partial Content", async () => {
    const res = await app.request(
      "/api/media/loops/warm_light_flow.mp4",
      {
        headers: { Range: "bytes=0-4" },
      },
      env,
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-range")).toBe("bytes 0-4/10");
    expect(res.headers.get("content-length")).toBe("5");
    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBe(5);
  });

  it("GET /api/media/:key returns 404 for non-existent key", async () => {
    const res = await app.request("/api/media/loops/non_existent.mp4", {}, env);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: API_ERRORS.media.notFound });
  });

  describe("Better Auth 마운트 (/api/auth/*)", () => {
    it("세션이 없어도 get-session이 500이 아니라 정상 응답을 준다", async () => {
      const res = await app.request("/api/auth/get-session", {}, env);

      expect(res.status).toBeLessThan(500);
    });

    it("자격증명이 설정된 프로바이더는 인가 URL을 돌려준다", async () => {
      const res = await app.request(
        "/api/auth/sign-in/social",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "kakao", callbackURL: "/" }),
        },
        {
          ...env,
          KAKAO_CLIENT_ID: "test-client-id",
          KAKAO_CLIENT_SECRET: "test-client-secret",
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string };
      expect(body.url).toContain("kauth.kakao.com");
      expect(body.url).toContain("api%2Fauth%2Fcallback%2Fkakao");
    });

    it("구글은 매번 계정을 고르게 하는 인가 URL을 돌려준다", async () => {
      const res = await app.request(
        "/api/auth/sign-in/social",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "google", callbackURL: "/" }),
        },
        {
          ...env,
          GOOGLE_CLIENT_ID: "test-client-id",
          GOOGLE_CLIENT_SECRET: "test-client-secret",
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string };
      const url = new URL(body.url);
      expect(url.hostname).toBe("accounts.google.com");
      expect(url.searchParams.get("prompt")).toBe("select_account");
      expect(url.searchParams.get("redirect_uri")).toMatch(
        /\/api\/auth\/callback\/google$/,
      );
    });

    it("자격증명이 없는 프로바이더는 404다", async () => {
      const res = await app.request(
        "/api/auth/sign-in/social",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "kakao", callbackURL: "/" }),
        },
        { ...env, KAKAO_CLIENT_ID: "", KAKAO_CLIENT_SECRET: "" },
      );

      expect(res.status).toBe(404);
    });

    it("인증 경로는 Hono의 전역 404가 아니라 Better Auth가 처리한다", async () => {
      const unknownAuth = await app.request(
        "/api/auth/nonexistent-endpoint",
        {},
        env,
      );
      const unknownApi = await app.request("/api/nonexistent", {}, env);

      expect(await unknownApi.json()).toEqual({ error: API_ERRORS.notFound });
      expect(await unknownAuth.text()).not.toBe(
        JSON.stringify({ error: API_ERRORS.notFound }),
      );
    });
  });

  describe("요청 본문 크기 제한", () => {
    it("로그인 전 인증 요청도 큰 본문은 끝까지 읽지 않고 413으로 끊는다", async () => {
      const { body, pulledBytes } = countingJsonArrayBody(3 * 1024 * 1024);

      const res = await app.request(
        "/api/auth/sign-out",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          duplex: "half",
        } as RequestInit,
        env,
      );

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: API_ERRORS.payloadTooLarge });
      expect(pulledBytes()).toBeLessThan(256 * 1024);
    });

    it("상한을 넘는 곡 저장은 Firestore에 닿기 전에 413이다", async () => {
      const res = await signedInApp.request(
        `/api/decks/${LIBRARY_DECK_ID}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            libraryDeck({ lyricsRaw: "가".repeat(1024 * 1024) }),
          ),
        },
        env,
      );

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: API_ERRORS.payloadTooLarge });
    });
  });

  describe("깨진 JSON 본문", () => {
    it.each([
      ["PUT", `/api/decks/${LIBRARY_DECK_ID}`, "{"],
      ["PUT", `/api/folders/${FOLDER_ID}`, '{"id":"f0000'],
      ["PATCH", `/api/presentations/${PRESENTATION_ID}`, "{x"],
    ])(
      "%s %s는 서버 오류가 아니라 400이고 오류 로그를 남기지 않는다",
      async (method, path, body) => {
        const errorLog = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const res = await signedInApp.request(
          path,
          { method, headers: { "content-type": "application/json" }, body },
          env,
        );

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: API_ERRORS.idMismatch });
        expect(errorLog).not.toHaveBeenCalled();
      },
    );
  });
  describe("동기화 라우트 마운트 (/api/presentations, /api/decks)", () => {
    it("세션 없이 접근하면 401이다 (404가 아니다)", async () => {
      for (const path of ["/api/presentations", "/api/decks"]) {
        const res = await app.request(path, {}, env);
        expect(res.status, path).toBe(401);
      }
    });

    it("쓰기·삭제도 세션 없이는 401이다", async () => {
      const id = "1000000000000000000ff";

      const put = await app.request(
        `/api/presentations/${id}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
        env,
      );
      expect(put.status).toBe(401);

      const del = await app.request(
        `/api/decks/${id}`,
        { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } },
        env,
      );
      expect(del.status).toBe(401);
    });
  });
});
