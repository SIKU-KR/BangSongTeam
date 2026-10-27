import { resolveFullscreenStrategy } from "./fullscreen";
import { SHELL_COPY } from "#copy/shell";
import { navigatorApi } from "./optionalApis";

type BrowserCapabilityId = "fullscreen" | "h264" | "offline";

interface BrowserCapability {
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
    label: SHELL_COPY.browserSupport.capabilities.fullscreen,
    isSupported: () => resolveFullscreenStrategy().kind !== "unsupported",
  },
  {
    id: "h264",
    label: SHELL_COPY.browserSupport.capabilities.h264,
    isSupported: () =>
      document.createElement("video").canPlayType(H264_MP4) !== "",
  },
  {
    id: "offline",
    label: SHELL_COPY.browserSupport.capabilities.offline,
    isSupported: () => canStoreMediaOffline() && "indexedDB" in window,
  },
];

export function isCacheStorageAvailable(): boolean {
  try {
    return typeof caches !== "undefined";
  } catch {
    return false;
  }
}

/**
 * 이 브라우저가 배경을 받아 두었다가 인터넷 없이 재생할 수 있는지.
 *
 * `<video>`·`<img>` 요청에 Cache Storage의 사본으로 답하는 것은 서비스 워커뿐이다. 서비스
 * 워커가 없는 브라우저(App-Bound Domain이 아닌 iOS 앱 안 WebView 등)에서는 받아 둔 사본을
 * 재생에 쓰지 못하고 재생이 같은 파일을 한 번 더 받으므로, 미디어 캐시는 받지 않는다.
 * 지원은 하지만 아직 페이지를 제어하지 않을 때(첫 방문, 강력 새로고침)는 받는다. 다음
 * 로드부터 서비스 워커가 그 사본으로 답한다.
 *
 * 브라우저 지원 배너의 '오프라인 송출'도 이 판단을 쓴다. 따로 판단하면 둘이 엇갈려, 배너는
 * 된다고 하는데 송출 준비 카드는 저장할 수 없다고 알린다. 렌더 중에도 부르므로 던지지
 * 않는다. 샌드박스 문서처럼 브라우저가 `navigator.serviceWorker` 접근을 `SecurityError`로
 * 거절하면 지원하지 않는 것으로 본다.
 */
export function canStoreMediaOffline(): boolean {
  try {
    return (
      navigatorApi("serviceWorker") !== undefined && isCacheStorageAvailable()
    );
  } catch {
    return false;
  }
}

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

/** 서비스 워커가 지금 페이지를 제어하는지. 제어하면 미디어 요청이 SW 캐시 라우트를 지난다 */
export function isServiceWorkerControlled(): boolean {
  return Boolean(navigatorApi("serviceWorker")?.controller);
}
