import { describe, it, expect } from "vitest";
import {
  MEDIA_CACHE_NAME,
  MEDIA_URL_PREFIX,
  PROJECTION_CHANNEL_NAME,
  PROJECTION_SYNC,
} from "./projection";
import { getBackgroundMediaUrl, INITIAL_BACKGROUNDS } from "./backgrounds";

describe("projection constants", () => {
  it("Workbox 런타임 캐시와 예배 준비 화면이 같은 캐시 이름을 쓴다", () => {
    // vite.config.ts의 runtimeCaching.cacheName과 반드시 동일해야 한다.
    expect(MEDIA_CACHE_NAME).toBe("worship-videos-cache");
  });

  it("미디어 URL 접두사가 실제 생성되는 URL과 일치한다", () => {
    const url = getBackgroundMediaUrl(INITIAL_BACKGROUNDS[0].id);
    expect(url?.startsWith(MEDIA_URL_PREFIX)).toBe(true);
  });

  it("BroadcastChannel 이름이 TECH_SPEC 5.3과 같다", () => {
    expect(PROJECTION_CHANNEL_NAME).toBe("worship-projection");
  });

  it("없는 번호 알림은 PRD 5에 따라 2초다", () => {
    expect(PROJECTION_SYNC.INVALID_JUMP_TOAST_MS).toBe(2000);
  });

  it("하트비트 간격보다 연결 끊김 판정 시간이 길다", () => {
    expect(PROJECTION_SYNC.AUDIENCE_TIMEOUT_MS).toBeGreaterThan(
      PROJECTION_SYNC.HEARTBEAT_INTERVAL_MS,
    );
  });
});
