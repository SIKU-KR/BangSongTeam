import { describe, it, expect, afterEach } from "vitest";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { makeBackground } from "../../test/backgroundFixture";
import { fetchBackgroundList } from "./backgroundApi";

describe("fetchBackgroundList", () => {
  let api: FakeApi | null = null;

  afterEach(() => api?.restore());

  it("형식이 어긋난 배경 하나 때문에 목록 전체를 버리지 않고 맞는 배경만 돌려준다", async () => {
    const valid = makeBackground(1);
    const numericKeyword = { ...makeBackground(2), keywords: ["a", 2024] };
    const missingDuration = { ...makeBackground(3), durationSec: null };
    api = installFakeApi({
      "GET /api/backgrounds": () => ({
        body: { backgrounds: [valid, numericKeyword, missingDuration] },
      }),
    });

    expect(await fetchBackgroundList()).toEqual({ backgrounds: [valid] });
  });

  it("목록 자체가 없는 응답은 받지 못한 것으로 본다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => ({ body: { items: [] } }),
    });

    await expect(fetchBackgroundList()).rejects.toThrow();
  });
});
