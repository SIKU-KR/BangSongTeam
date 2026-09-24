import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { signInAsTestUser } from "../../test/sessionFixture";
import { makeBackground } from "../../test/backgroundFixture";
import { getOfflineDB } from "../../lib/storage";
import {
  addUploadedBackground,
  applyServerBackgroundCatalog,
  getBackgroundById,
  getBackgroundCatalog,
  getServiceBackgrounds,
  hydrateBackgroundCatalog,
  removeUploadedBackground,
  resetBackgroundCatalogForTests,
  resolveBackgroundLayers,
  useBackground,
} from "./backgroundCatalog";

const USER_A = "userA0000000000000001";
const SERVICE = makeBackground(1, { title: "나 배경" });
const UPLOADED = makeBackground(2, { title: "가 배경" });

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
    await applyServerBackgroundCatalog([UPLOADED, SERVICE], true);
    resetBackgroundCatalogForTests();
    expect(getBackgroundById(SERVICE.id)).toBeUndefined();

    await hydrateBackgroundCatalog();

    expect(getBackgroundById(SERVICE.id)).toEqual(SERVICE);
    expect(getServiceBackgrounds()).toEqual([UPLOADED, SERVICE]);
  });

  it("관리 권한은 서버 응답에서만 오고 로컬 사본으로는 켜지지 않는다", async () => {
    await applyServerBackgroundCatalog([SERVICE], true);
    expect(getBackgroundCatalog().canManage).toBe(true);

    await hydrateBackgroundCatalog();
    expect(getBackgroundCatalog().canManage).toBe(false);
  });

  it("서버 목록으로 바꾸면 지워진 배경이 로컬에 남지 않는다", async () => {
    await applyServerBackgroundCatalog([UPLOADED, SERVICE], false);
    await applyServerBackgroundCatalog([SERVICE], false);
    resetBackgroundCatalogForTests();

    await hydrateBackgroundCatalog();

    expect(getBackgroundById(UPLOADED.id)).toBeUndefined();
  });

  it("올린 배경을 제목순으로 끼워 넣고, 올리고 지운 배경을 구독자에게 곧바로 알린다", async () => {
    await applyServerBackgroundCatalog([SERVICE], true);
    const { result } = renderHook(() => useBackground(UPLOADED.id));
    expect(result.current).toBeUndefined();

    await act(async () => {
      await addUploadedBackground(UPLOADED);
    });
    expect(result.current).toEqual(UPLOADED);
    expect(getBackgroundCatalog().backgrounds).toEqual([UPLOADED, SERVICE]);

    await act(async () => {
      await removeUploadedBackground(UPLOADED.id);
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
