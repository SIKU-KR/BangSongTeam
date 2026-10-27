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

    expect(await fetchBackgroundList()).toEqual({
      backgrounds: [valid],
      unreadableIds: [numericKeyword.id, missingDuration.id],
    });
  });

  it("배경이 있는데 하나도 읽지 못하면 받지 못한 것으로 본다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => ({
        body: {
          backgrounds: [
            { ...makeBackground(1), license: undefined },
            { ...makeBackground(2), durationSec: "20" },
          ],
        },
      }),
    });

    await expect(fetchBackgroundList()).rejects.toThrow();
  });

  it("배경이 하나도 없는 목록은 그대로 받는다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => ({ body: { backgrounds: [] } }),
    });

    expect(await fetchBackgroundList()).toEqual({
      backgrounds: [],
      unreadableIds: [],
    });
  });

  it("id도 읽지 못한 배경은 남길 사본을 찾을 수 없으므로 빼기만 한다", async () => {
    const valid = makeBackground(1);
    api = installFakeApi({
      "GET /api/backgrounds": () => ({
        body: { backgrounds: [valid, { title: "id 없음" }, "문자열"] },
      }),
    });

    expect(await fetchBackgroundList()).toEqual({
      backgrounds: [valid],
      unreadableIds: [],
    });
  });

  it("목록 자체가 없는 응답은 받지 못한 것으로 본다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => ({ body: { items: [] } }),
    });

    await expect(fetchBackgroundList()).rejects.toThrow();
  });
});
