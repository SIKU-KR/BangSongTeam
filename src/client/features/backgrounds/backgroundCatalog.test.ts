import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { signInAsTestUser } from "../../test/sessionFixture";
import { makeBackground } from "../../test/backgroundFixture";
import { getOfflineDB } from "../../lib/storage/db";
import {
  applyServerBackgroundCatalog,
  getBackgroundById,
  getBackgrounds,
  hydrateBackgroundCatalog,
  resetBackgroundCatalogForTests,
  resolveBackgroundLayers,
  useBackground,
} from "./backgroundCatalog";

const USER_A = "userA0000000000000001";
const BACKGROUND_B = makeBackground(1, { title: "나 배경" });
const BACKGROUND_A = makeBackground(2, { title: "가 배경" });

async function clearStoredBackgrounds(): Promise<void> {
  const db = await getOfflineDB();
  await db.clear("backgrounds");
}

describe("배경 카탈로그", () => {
  beforeEach(async () => {
    signInAsTestUser(USER_A);
    resetBackgroundCatalogForTests();
    await clearStoredBackgrounds();
  });

  it("서버 목록을 IndexedDB에 남겨 두고 다음 부팅(송출 화면)에서 서버 없이 되살린다", async () => {
    await applyServerBackgroundCatalog([BACKGROUND_A, BACKGROUND_B]);
    resetBackgroundCatalogForTests();
    expect(getBackgroundById(BACKGROUND_B.id)).toBeUndefined();

    await hydrateBackgroundCatalog();

    expect(getBackgroundById(BACKGROUND_B.id)).toEqual(BACKGROUND_B);
    expect(getBackgrounds()).toEqual([BACKGROUND_A, BACKGROUND_B]);
  });

  it("서버 목록으로 바꾸면 지워진 배경이 로컬에 남지 않는다", async () => {
    await applyServerBackgroundCatalog([BACKGROUND_A, BACKGROUND_B]);
    await applyServerBackgroundCatalog([BACKGROUND_B]);
    resetBackgroundCatalogForTests();

    await hydrateBackgroundCatalog();

    expect(getBackgroundById(BACKGROUND_A.id)).toBeUndefined();
  });

  it("서버 목록에서 빠진 배경을 구독자에게 곧바로 알린다", async () => {
    await applyServerBackgroundCatalog([BACKGROUND_A, BACKGROUND_B]);
    const { result } = renderHook(() => useBackground(BACKGROUND_A.id));
    expect(result.current).toEqual(BACKGROUND_A);

    await act(async () => {
      await applyServerBackgroundCatalog([BACKGROUND_B]);
    });
    expect(result.current).toBeUndefined();
  });

  it("영상 배경은 영상 레이어로, 이미지 배경은 정지 이미지 레이어로 그린다", () => {
    expect(resolveBackgroundLayers(BACKGROUND_B)).toEqual({
      videoUrl: BACKGROUND_B.mediaUrl,
      posterUrl: BACKGROUND_B.posterUrl,
    });
    const image = makeBackground(3, {
      kind: "image",
      mediaUrl: "/api/media/stills/3.png",
      posterUrl: "/api/media/stills/3.png",
    });
    expect(resolveBackgroundLayers(image)).toEqual({
      imageUrl: image.mediaUrl,
      posterUrl: image.posterUrl,
    });
    expect(resolveBackgroundLayers(undefined)).toEqual({});
  });
});
