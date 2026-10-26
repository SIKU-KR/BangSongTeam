import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { API_ERRORS, SearchCatalogResponseSchema } from "#shared";
import { decksCol } from "../../db/collections";
import { clearDb, deckDoc, seedDocs, userDoc } from "../../db/test/fixtures";
import { env } from "../test/env";
import { createApp } from "../index";

const AUTHOR = "aaaaaaaa7000000000001";
const DECK = "c00000007000000000001";

function search(
  app: ReturnType<typeof createApp>,
  q: string,
  ip = "10.0.0.1",
): Promise<Response> {
  return Promise.resolve(
    app.request(
      `/api/catalog/search?q=${encodeURIComponent(q)}`,
      { headers: { "x-forwarded-for": ip } },
      env,
    ),
  );
}

describe("GET /api/catalog/search", () => {
  beforeEach(async () => {
    await clearDb(env.DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("같은 IP가 1분 안에 120번을 넘게 검색하면 429이고 다른 IP는 그대로 검색한다", async () => {
    const app = createApp();

    for (let index = 0; index < 120; index += 1) {
      expect((await search(app, "z", "10.0.0.9")).status).toBe(200);
    }
    const limited = await search(app, "z", "10.0.0.9");
    const otherIp = await search(app, "z", "10.0.0.10");

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: API_ERRORS.tooManyRequests,
    });
    expect(otherIp.status).toBe(200);
  });

  it("후보 수를 세지 못해도 검색 결과를 주고 경고 로그를 남긴다", async () => {
    await seedDocs(env.DB, {
      users: [userDoc({ id: AUTHOR, name: "김찬양" })],
      decks: [
        deckDoc({
          id: DECK,
          userId: AUTHOR,
          title: "은혜로운 주의 사랑",
          visibility: "public",
        }),
      ],
    });
    const aggregateQuery: { get: () => Promise<unknown> } =
      Object.getPrototypeOf(decksCol(env.DB).count());
    vi.spyOn(aggregateQuery, "get").mockRejectedValue(
      new Error("index not ready"),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await search(createApp(), "은혜로운");

    expect(res.status).toBe(200);
    const { decks } = SearchCatalogResponseSchema.parse(await res.json());
    expect(decks.map((deck) => deck.id)).toEqual([DECK]);
    const warnings = log.mock.calls
      .map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
      .filter((line) => line.event === "catalog_search_count_failed");
    expect(warnings).toEqual([
      expect.objectContaining({
        severity: "WARNING",
        requestId: res.headers.get("x-request-id"),
        error: expect.objectContaining({ message: "index not ready" }),
      }),
    ]);
  });
});
