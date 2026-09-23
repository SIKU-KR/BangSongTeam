import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { verifyNormalization } from "@repo/shared";
import { createD1Client, lyricsCatalog, lyricsVersions, user } from "@repo/db";
import {
  createWorkersAiRunner,
  normalizeCatalog,
  NORMALIZATION_MODEL,
  type ModelRunner,
} from "./normalization";

const A = "aaaaaaaa-4444-4000-8000-000000000001";
const B = "bbbbbbbb-4444-4000-8000-000000000002";
const CAT = "d0000000-4444-4000-8000-000000000001";

// 두 사람이 같은 곡을 조금씩 다르게 붙여넣었다 (띄어쓰기·오타)
const VERSION_A = [
  "시작됐네 우리 주님의 능력이",
  "나의 삶을 다스리시네",
  "",
  "주의 은혜 아래 나 거하며",
  "주의 사랑 안에 살리",
  "",
  "할렐루야 할렐루야",
].join("\n");
const VERSION_B = [
  "시작됐네 우리 주님의 능력이",
  "나의 삶을 다스리시네",
  "",
  "주의 은혜아래 나 거하며",
  "주의 사랑안에 살리",
  "",
  "할렐루야 할렐루야",
].join("\n");
const CANONICAL = VERSION_A;

function fakeRunner(
  text: string,
  finishReason: string | null = "stop",
): ModelRunner {
  return vi.fn(async () => ({ text, finishReason }));
}

/** drizzle-orm은 apps/web의 직접 의존성이 아니므로 원시 D1로 읽는다 */
async function readCatalog() {
  const row = await env.DB.prepare(
    "SELECT status, canonical_source, lyrics_canonical FROM lyrics_catalog WHERE id = ?",
  )
    .bind(CAT)
    .first<{
      status: string;
      canonical_source: string;
      lyrics_canonical: string;
    }>();
  return {
    status: row?.status,
    canonicalSource: row?.canonical_source,
    lyricsCanonical: row?.lyrics_canonical ?? "",
  };
}

describe("normalizeCatalog (workerd D1)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM lyrics_versions");
    await env.DB.exec("DELETE FROM decks");
    await env.DB.exec("DELETE FROM lyrics_catalog");
    await env.DB.exec(`DELETE FROM user WHERE id IN ('${A}', '${B}')`);
    const db = createD1Client(env.DB);
    await db.insert(user).values([
      { id: A, name: "A", createdAt: new Date(), updatedAt: new Date() },
      { id: B, name: "B", createdAt: new Date(), updatedAt: new Date() },
    ]);
    await db.insert(lyricsCatalog).values({
      id: CAT,
      title: "은혜로다",
      titleNorm: "은혜로다",
      artistNorm: "",
      lyricsCanonical: VERSION_A,
      versionCount: 2,
    });
    await db.insert(lyricsVersions).values([
      {
        id: "v-a",
        catalogId: CAT,
        userId: A,
        deckId: "deck-a",
        lyrics: VERSION_A,
        createdAt: new Date("2026-09-21T00:00:00Z"),
      },
      {
        id: "v-b",
        catalogId: CAT,
        userId: B,
        deckId: "deck-b",
        lyrics: VERSION_B,
        createdAt: new Date("2026-09-22T00:00:00Z"),
      },
    ]);
  });

  it("adopts a verified LLM result (PRD 8 M5 완료 기준 b)", async () => {
    const outcome = await normalizeCatalog(
      createD1Client(env.DB),
      CAT,
      fakeRunner(CANONICAL),
    );
    expect(outcome).toEqual({ kind: "llm" });

    const catalog = await readCatalog();
    expect(catalog.status).toBe("normalized");
    expect(catalog.canonicalSource).toBe("llm");
    expect(
      verifyNormalization(catalog.lyricsCanonical, [VERSION_A, VERSION_B]),
    ).toBe(true);
  });

  it("sends both versions with the fixed prompt", async () => {
    const runner = fakeRunner(CANONICAL);
    await normalizeCatalog(createD1Client(env.DB), CAT, runner);
    const [{ messages, maxTokens }] = (runner as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(messages[0].content).toContain("DO NOT invent");
    expect(messages[1].content).toContain("주의 은혜아래 나 거하며");
    expect(maxTokens).toBeGreaterThanOrEqual(512);
  });

  it("strips a leaked <think> block before verifying", async () => {
    const outcome = await normalizeCatalog(
      createD1Client(env.DB),
      CAT,
      fakeRunner(`<think>두 버전을 비교하면…</think>\n${CANONICAL}`),
    );
    expect(outcome.kind).toBe("llm");
    expect((await readCatalog()).lyricsCanonical).toBe(CANONICAL);
  });

  it.each([
    ["hallucinated line", fakeRunner(`${CANONICAL}\n지어낸 가사 한 줄`)],
    ["output truncated", fakeRunner(CANONICAL, "length")],
    ["empty output", fakeRunner("   ")],
    ["incomplete output", fakeRunner("시작됐네 우리 주님의 능력이")],
  ])("falls back to the popular root on %s", async (reason, runner) => {
    const outcome = await normalizeCatalog(createD1Client(env.DB), CAT, runner);
    expect(outcome).toEqual({ kind: "popular_root", reason });

    const catalog = await readCatalog();
    expect(catalog.status).toBe("normalized");
    expect(catalog.canonicalSource).toBe("popular_root");
    // 동률이면 먼저 등록된 A의 버전
    expect(catalog.lyricsCanonical).toBe(VERSION_A);
  });

  it("falls back when the model call throws (quota, gateway cap, outage)", async () => {
    const runner: ModelRunner = async () => {
      throw new Error("AI Gateway budget exceeded");
    };
    const outcome = await normalizeCatalog(createD1Client(env.DB), CAT, runner);
    expect(outcome.kind).toBe("popular_root");
    expect((await readCatalog()).canonicalSource).toBe("popular_root");
  });

  it("skips operator-locked catalogs without calling the model", async () => {
    await env.DB.prepare(
      "UPDATE lyrics_catalog SET status = 'locked' WHERE id = ?",
    )
      .bind(CAT)
      .run();
    const runner = fakeRunner(CANONICAL);
    expect(await normalizeCatalog(createD1Client(env.DB), CAT, runner)).toEqual(
      {
        kind: "skipped_locked",
      },
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("skips catalogs with a single root version", async () => {
    await env.DB.prepare("DELETE FROM lyrics_versions WHERE id = 'v-b'").run();
    const runner = fakeRunner(CANONICAL);
    expect(
      (await normalizeCatalog(createD1Client(env.DB), CAT, runner)).kind,
    ).toBe("skipped_single");
    expect(runner).not.toHaveBeenCalled();
  });
});

describe("createWorkersAiRunner", () => {
  it("calls the fixed model with temperature 0 and thinking off", async () => {
    const run = vi.fn(async () => ({
      choices: [{ message: { content: "가사" }, finish_reason: "stop" }],
    }));
    const runner = createWorkersAiRunner(
      { run } as unknown as Ai,
      "worship-gw",
    );
    const output = await runner({
      messages: [{ role: "user", content: "x" }],
      maxTokens: 600,
    });

    expect(output).toEqual({ text: "가사", finishReason: "stop" });
    expect(run).toHaveBeenCalledWith(
      NORMALIZATION_MODEL,
      expect.objectContaining({
        temperature: 0,
        max_tokens: 600,
        chat_template_kwargs: { enable_thinking: false },
      }),
      { gateway: { id: "worship-gw" } },
    );
  });

  it("reads the legacy { response } shape", async () => {
    const run = vi.fn(async () => ({ response: "가사" }));
    const runner = createWorkersAiRunner({ run } as unknown as Ai);
    expect(await runner({ messages: [], maxTokens: 512 })).toEqual({
      text: "가사",
      finishReason: null,
    });
    expect((run.mock.calls[0] as unknown[])[2]).toBeUndefined();
  });
});
