import { describe, it, expect, vi } from "vitest";
import {
  BACKGROUND_EMBEDDING_MODEL,
  BACKGROUND_QUERY_INSTRUCTION,
} from "#shared";
import type { Bindings } from "../types";
import { searchBackgroundsWithVectorize } from "./backgroundSearch";

function fakeEnv(scores: number[]) {
  const run = vi.fn(async () => ({ data: [[0.1, 0.2]], shape: [1, 2] }));
  const query = vi.fn(async () => ({
    count: scores.length,
    matches: scores.map((score, n) => ({ id: `bg-${n}`, score })),
  }));
  const env = {
    AI: { run },
    BACKGROUND_INDEX: { query },
  } as unknown as Bindings;
  return { env, run, query };
}

describe("searchBackgroundsWithVectorize", () => {
  it("검색어에 검색용 지시문을 붙여 임베딩하고 그 벡터로 인덱스를 찾는다", async () => {
    const { env, run, query } = fakeEnv([0.7]);
    await searchBackgroundsWithVectorize(env, "성탄");

    expect(run).toHaveBeenCalledWith(BACKGROUND_EMBEDDING_MODEL, {
      queries: "성탄",
      instruction: BACKGROUND_QUERY_INSTRUCTION,
    });
    expect(query).toHaveBeenCalledWith([0.1, 0.2], { topK: 50 });
  });

  it("1등보다 0.1 넘게 낮은 배경은 버린다", async () => {
    const { env } = fakeEnv([0.75, 0.66, 0.64, 0.6]);
    const results = await searchBackgroundsWithVectorize(env, "가을 낙엽");
    expect(results.map((result) => result.id)).toEqual(["bg-0", "bg-1"]);
  });

  it("관련 없는 검색어처럼 점수가 모두 낮으면 아무것도 주지 않는다", async () => {
    const { env } = fakeEnv([0.51, 0.49, 0.45]);
    expect(await searchBackgroundsWithVectorize(env, "고양이")).toEqual([]);
  });
});
