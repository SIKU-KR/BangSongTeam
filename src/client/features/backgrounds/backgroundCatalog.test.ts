import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { signInAsTestUser, signOutForTests } from "../../test/sessionFixture";
import { makeBackground } from "../../test/backgroundFixture";
import { getOfflineDB } from "../../lib/storage";
import {
  addUploadedBackground,
  applyServerBackgroundCatalog,
  getBackgroundById,
  getServiceBackgrounds,
  hydrateBackgroundCatalog,
  removeUploadedBackground,
  resetBackgroundCatalogForTests,
  resolveBackgroundLayers,
  useBackground,
} from "./backgroundCatalog";

const USER_A = "userA0000000000000001";
const USER_B = "userB0000000000000002";
const SERVICE = makeBackground(1);
const MINE = makeBackground(2, { source: "user" });
const USAGE = { usedBytes: MINE.sizeBytes, limitBytes: 300 * 1024 * 1024 };

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
    await applyServerBackgroundCatalog([SERVICE, MINE], USAGE);
    resetBackgroundCatalogForTests();
    expect(getBackgroundById(SERVICE.id)).toBeUndefined();

    await hydrateBackgroundCatalog();

    expect(getBackgroundById(SERVICE.id)).toEqual(SERVICE);
    expect(getBackgroundById(MINE.id)).toEqual(MINE);
    expect(getServiceBackgrounds()).toEqual([SERVICE]);
  });

  it("같은 컴퓨터를 쓰는 다른 봉사자에게는 내가 올린 배경을 되살리지 않는다", async () => {
    await applyServerBackgroundCatalog([SERVICE, MINE], USAGE);

    signInAsTestUser(USER_B);
    await hydrateBackgroundCatalog();
    expect(getBackgroundById(SERVICE.id)).toEqual(SERVICE);
    expect(getBackgroundById(MINE.id)).toBeUndefined();

    signOutForTests();
    await hydrateBackgroundCatalog();
    expect(getBackgroundById(MINE.id)).toBeUndefined();
  });

  it("서버 목록으로 바꾸면 지워진 배경이 로컬에 남지 않는다", async () => {
    await applyServerBackgroundCatalog([SERVICE, MINE], USAGE);
    await applyServerBackgroundCatalog([SERVICE], null);
    resetBackgroundCatalogForTests();

    await hydrateBackgroundCatalog();

    expect(getBackgroundById(MINE.id)).toBeUndefined();
  });

  it("올리고 지운 배경을 구독자에게 곧바로 알린다", async () => {
    await applyServerBackgroundCatalog([SERVICE], null);
    const { result } = renderHook(() => useBackground(MINE.id));
    expect(result.current).toBeUndefined();

    await act(async () => {
      await addUploadedBackground(MINE, USAGE);
    });
    expect(result.current).toEqual(MINE);

    await act(async () => {
      await removeUploadedBackground(MINE.id, { ...USAGE, usedBytes: 0 });
    });
    expect(result.current).toBeUndefined();
  });

  it("영상 배경은 영상 레이어로, 이미지 배경은 정지 이미지 레이어로 그린다", () => {
    expect(resolveBackgroundLayers(SERVICE)).toEqual({
      videoUrl: SERVICE.mediaUrl,
      posterUrl: SERVICE.posterUrl,
    });
    const image = makeBackground(3, {
      kind: "image",
      mediaUrl: "/api/media/uploads/u/3.png",
      posterUrl: "/api/media/uploads/u/3.png",
    });
    expect(resolveBackgroundLayers(image)).toEqual({
      imageUrl: image.mediaUrl,
      posterUrl: image.posterUrl,
    });
    expect(resolveBackgroundLayers(undefined)).toEqual({});
  });
});
