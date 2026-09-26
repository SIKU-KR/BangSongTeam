import { resolveFullscreenStrategy } from "./fullscreen";

export type BrowserCapabilityId = "fullscreen" | "h264" | "offline";

export interface BrowserCapability {
  id: BrowserCapabilityId;
  /** 배너에 보여 줄 기능 이름 */
  label: string;
  isSupported: () => boolean;
}

const H264_MP4 = 'video/mp4; codecs="avc1.42E01E"';

/**
 * 송출과 오프라인 예배에 필요한 기능 목록.
 * 브라우저 이름이 아니라 기능이 있는지로 판별한다. Edge·Whale·Safari·Firefox도
 * 이 기능이 모두 있으면 Chrome과 똑같이 대한다.
 */
export const BROWSER_CAPABILITIES: readonly BrowserCapability[] = [
  {
    id: "fullscreen",
    label: "전체화면 송출",
    isSupported: () => resolveFullscreenStrategy().kind !== "unsupported",
  },
  {
    id: "h264",
    label: "배경 영상(H.264) 재생",
    isSupported: () =>
      document.createElement("video").canPlayType(H264_MP4) !== "",
  },
  {
    id: "offline",
    label: "오프라인 송출",
    isSupported: () =>
      "serviceWorker" in navigator &&
      "caches" in window &&
      "indexedDB" in window,
  },
];

const PRESENTATION_CAPABILITIES: readonly BrowserCapabilityId[] = [
  "fullscreen",
  "h264",
];

/** 이 브라우저에 없는 기능. 브라우저 밖(테스트 전 단계 등)에서는 빈 배열이다 */
export function getMissingCapabilities(): BrowserCapability[] {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return [];
  }
  return BROWSER_CAPABILITIES.filter((capability) => {
    try {
      return !capability.isSupported();
    } catch {
      return true;
    }
  });
}

/** 전체화면 송출과 배경 영상 재생이 모두 되면 true. 아니면 송출 전에 한 번 더 확인한다 */
export function canPresentReliably(): boolean {
  return !getMissingCapabilities().some((capability) =>
    PRESENTATION_CAPABILITIES.includes(capability.id),
  );
}
