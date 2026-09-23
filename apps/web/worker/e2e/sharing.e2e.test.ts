import { describe, it, expect, beforeEach } from "vitest";
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  PresentationDocumentSchema,
  SearchCatalogResponseSchema,
  verifyNormalization,
  type Deck,
  type PresentationDocument,
} from "@repo/shared";
import { createD1Client, user } from "@repo/db";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";
import type { ModelRunner } from "../lib/normalization";

/**
 * M5 완료 기준 (PRD 8장) 두 가지를 실제 라우트로 끝까지 따라간다.
 *
 * (a) 다른 계정으로 공개 덱을 검색해 가져온 뒤 수정 없이 송출한다
 *     — 송출은 로컬 IndexedDB에서 도므로, 여기서는 '가져온 곡이 담긴 세트가
 *       서버에서 원본과 같은 슬라이드·스타일로 돌아온다'까지 본다
 * (b) 같은 곡을 2개 계정이 등록했을 때 정규화 결과가 검증(4.8)을 통과한다
 *     — 모델은 가짜다. 실제 Qwen 확인은 운영 런북 §6
 */
const A = "aaaaaaaa-6666-4000-8000-000000000001";
const B = "bbbbbbbb-6666-4000-8000-000000000002";
const A_DECK = "c0000000-6666-4000-8000-00000000000a";
const B_DECK = "c0000000-6666-4000-8000-00000000000b";
const B_SET = "10000000-6666-4000-8000-00000000000b";

let currentUser = A;
let modelText = "";
const readSession: SessionReader = async () => ({ userId: currentUser });
const modelRunner = (): ModelRunner => async () => ({
  text: modelText,
  finishReason: "stop",
});
const app = createApp({ readSession, modelRunner });

async function call(method: string, path: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await app.request(
    path,
    {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
    ctx,
  );
  // 응답 뒤 백그라운드 작업(정규화)까지 끝난 상태에서 다음 단계를 본다
  await waitOnExecutionContext(ctx);
  return res;
}

const A_LYRICS = [
  "시작됐네 우리 주님의 능력이",
  "나의 삶을 다스리시네",
  "",
  "주의 은혜 아래 나 거하며",
  "주의 사랑 안에 살리",
].join("\n");

function librarySong(
  id: string,
  userId: string,
  lyrics: string,
  overrides: Partial<Deck> = {},
): Deck {
  const blocks = lyrics.split("\n\n");
  return DeckSchema.parse({
    id,
    userId,
    scope: "library",
    title: "은혜로다",
    artist: "예수전도단",
    lyricsRaw: lyrics,
    slides: blocks.map((block, order) => ({
      id: `s${order}`,
      order,
      lines: block.split("\n"),
    })),
    backgroundId: null,
    style: { ...DEFAULT_DECK_STYLE, overlayOpacity: 65, fontSizeVw: 5.1 },
    contributeToCatalog: false,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

describe("M5 완료 기준 — 2계정 E2E", () => {
  beforeEach(async () => {
    for (const table of [
      "reports",
      "presentation_items",
      "decks",
      "presentations",
      "lyrics_versions",
      "lyrics_catalog",
    ]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec(`DELETE FROM user WHERE id IN ('${A}', '${B}')`);
    await createD1Client(env.DB)
      .insert(user)
      .values([
        {
          id: A,
          name: "A교회 찬양팀",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: B,
          name: "B교회 미디어",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    currentUser = A;
    modelText = "";
  });

  it("(a) B가 A의 공개 덱을 검색·가져와 세트에 담으면 원본 그대로 돌아온다", async () => {
    // A: 곡을 보관함에 저장하고, 저작권 안내에 동의해 공개한다
    const original = librarySong(A_DECK, A, A_LYRICS);
    expect((await call("PUT", `/api/decks/${A_DECK}`, original)).status).toBe(
      200,
    );
    expect(
      (
        await call("PATCH", `/api/decks/${A_DECK}/visibility`, {
          visibility: "public",
          acceptedCopyrightNotice: true,
        })
      ).status,
    ).toBe(200);

    // B: 검색하면 미리보기만 보인다
    currentUser = B;
    const search = SearchCatalogResponseSchema.parse(
      await (await call("GET", "/api/catalog/search?q=은혜로다")).json(),
    );
    expect(search.decks.map((d) => d.id)).toEqual([A_DECK]);
    expect(search.decks[0].firstSlidePreview).toEqual([
      "시작됐네 우리 주님의 능력이",
      "나의 삶을 다스리시네",
    ]);

    // B: 전문을 확인하고 가져온다
    expect((await call("GET", `/api/catalog/decks/${A_DECK}`)).status).toBe(
      200,
    );
    const forkRes = await call("POST", `/api/decks/${A_DECK}/fork`);
    const { deck: fork } = (await forkRes.json()) as { deck: Deck };
    expect(fork.forkedFromAuthorName).toBe("A교회 찬양팀");

    // B: 편집기가 하듯 세트 전용 복제본으로 담아 저장한다 (수정 없음)
    const clone: Deck = {
      ...fork,
      id: "c0000000-6666-4000-8000-0000000000c1",
      scope: "presentation",
      presentationId: B_SET,
      forkedFrom: fork.id,
      visibility: "private",
      forkCount: 0,
    };
    const doc: PresentationDocument = PresentationDocumentSchema.parse({
      id: B_SET,
      userId: B,
      title: "B교회 주일 예배",
      serviceDate: "2026-09-27",
      items: [
        {
          id: "30000000-6666-4000-8000-000000000001",
          presentationId: B_SET,
          deckId: clone.id,
          order: 0,
          deck: clone,
        },
      ],
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    });
    expect((await call("PUT", `/api/presentations/${B_SET}`, doc)).status).toBe(
      200,
    );

    // 다른 PC에서 B가 세트를 받으면 A가 만든 슬라이드·스타일 그대로다
    const { presentations } = (await (
      await call("GET", "/api/presentations")
    ).json()) as {
      presentations: PresentationDocument[];
    };
    const song = presentations[0].items[0].deck;
    expect(song.slides.map((s) => s.lines)).toEqual(
      original.slides.map((s) => s.lines),
    );
    expect(song.style).toEqual(original.style);
    expect(song.visibility).toBe("private");
    expect(song.forkedFromAuthorName).toBe("A교회 찬양팀");

    // A 덱의 가져간 횟수가 1 올랐다
    const after = SearchCatalogResponseSchema.parse(
      await (await call("GET", "/api/catalog/search?q=은혜로다")).json(),
    );
    expect(after.decks[0].forkCount).toBe(1);
  });

  it("(b) 두 계정이 같은 곡을 등록하면 정규화 결과가 검증을 통과한다", async () => {
    const bLyrics = A_LYRICS.replace("은혜 아래", "은혜아래").replace(
      "사랑 안에",
      "사랑안에",
    );

    await call(
      "PUT",
      `/api/decks/${A_DECK}`,
      librarySong(A_DECK, A, A_LYRICS, { contributeToCatalog: true }),
    );
    currentUser = B;
    modelText = A_LYRICS; // 모델이 띄어쓰기를 다수·정본 쪽으로 맞췄다
    await call(
      "PUT",
      `/api/decks/${B_DECK}`,
      librarySong(B_DECK, B, bLyrics, { contributeToCatalog: true }),
    );

    const catalog = await env.DB.prepare(
      "SELECT id, status, canonical_source, lyrics_canonical, version_count FROM lyrics_catalog",
    ).first<{
      id: string;
      status: string;
      canonical_source: string;
      lyrics_canonical: string;
      version_count: number;
    }>();
    expect(catalog).toMatchObject({
      status: "normalized",
      canonical_source: "llm",
      version_count: 2,
    });
    expect(
      verifyNormalization(catalog!.lyrics_canonical, [A_LYRICS, bLyrics]),
    ).toBe(true);

    // 검색 결과에 '정규화됨 · 2명 등록'의 근거가 실린다
    const search = SearchCatalogResponseSchema.parse(
      await (await call("GET", "/api/catalog/search?q=은혜로다")).json(),
    );
    expect(search.catalogLyrics[0]).toMatchObject({
      status: "normalized",
      versionCount: 2,
    });
  });

  it("(b') 모델이 가사를 지어내면 버리고 최다 등록 버전을 쓴다", async () => {
    await call(
      "PUT",
      `/api/decks/${A_DECK}`,
      librarySong(A_DECK, A, A_LYRICS, { contributeToCatalog: true }),
    );
    currentUser = B;
    modelText = `${A_LYRICS}\n영원히 주를 찬양하리`; // 입력에 없는 줄
    await call(
      "PUT",
      `/api/decks/${B_DECK}`,
      librarySong(B_DECK, B, A_LYRICS, { contributeToCatalog: true }),
    );

    const catalog = await env.DB.prepare(
      "SELECT canonical_source, lyrics_canonical FROM lyrics_catalog",
    ).first<{ canonical_source: string; lyrics_canonical: string }>();
    expect(catalog?.canonical_source).toBe("popular_root");
    expect(catalog?.lyrics_canonical).not.toContain("영원히 주를 찬양하리");
    expect(verifyNormalization(catalog!.lyrics_canonical, [A_LYRICS])).toBe(
      true,
    );
  });
});
