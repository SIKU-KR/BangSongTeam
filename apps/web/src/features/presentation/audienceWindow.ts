import { AUDIENCE_MODE_PARAM, AUDIENCE_WINDOW_NAME } from "@repo/shared";

/**
 * 청중 송출 창 열기 (PRD 7.3, TECH_SPEC 5.3).
 *
 * Chrome Window Management API로 연결된 화면 목록을 읽어 보조 모니터가 있으면
 * 그 좌표로 창을 띄운다. 권한을 거부했거나 모니터가 하나면 일반 팝업으로
 * 열고 '이 창을 프로젝터 화면으로 옮긴 뒤 클릭하면 전체화면이 됩니다' 안내로
 * 대체한다 — 권한 거부가 막다른 길이 되면 안 된다.
 *
 * 팝업 차단은 따로 구분해 보고한다. 조용히 실패하면 조작자는 송출 창이 왜 안
 * 뜨는지 알 수 없다.
 */

export type AudienceWindowStatus =
  /** 보조 모니터 좌표로 열었다 */
  | "secondary"
  /** 보조 모니터를 못 찾아(또는 권한 거부) 일반 팝업으로 열었다 */
  | "fallback"
  /** 브라우저가 팝업을 막았다 */
  | "blocked";

export interface AudienceWindowResult {
  status: AudienceWindowStatus;
  window: Window | null;
  /** 조작 창에 그대로 보여 줄 안내 문구 */
  message: string;
}

interface ScreenLike {
  availLeft?: number;
  availTop?: number;
  availWidth?: number;
  availHeight?: number;
}

interface ScreenDetailsLike {
  screens: ScreenLike[];
  currentScreen: ScreenLike;
}

const FALLBACK_FEATURES = "width=1280,height=720";

const MESSAGES: Record<AudienceWindowStatus, string> = {
  secondary: "보조 모니터에 송출 창을 열었습니다.",
  fallback:
    "송출 창을 열었습니다. 이 창을 프로젝터 화면으로 옮긴 뒤 클릭하면 전체화면이 됩니다.",
  blocked:
    "브라우저가 팝업을 막았습니다. 주소창의 팝업 차단을 해제한 뒤 다시 시도해 주세요.",
};

/** 청중 창 URL. 경로는 PRD 5 화면 목록의 전체화면 송출 경로를 그대로 쓴다. */
export function buildAudienceUrl(presentationId: string): string {
  return `/present/${presentationId}/fullscreen?${AUDIENCE_MODE_PARAM}=1`;
}

/**
 * 보조 모니터를 찾는다.
 *
 * 기존 `checkScreenDetails()`는 권한이 **이미** granted일 때만 화면을 읽어,
 * 사용자가 한 번도 허용한 적이 없으면 영원히 null이었다(그래서 호출부가 없는
 * 죽은 코드였다). 여기서는 `getScreenDetails()`를 직접 불러 권한을 요청한다.
 */
async function findSecondaryScreen(): Promise<ScreenLike | null> {
  if (typeof window === "undefined" || !("getScreenDetails" in window)) {
    return null;
  }

  try {
    const details = await (
      window as unknown as {
        getScreenDetails: () => Promise<ScreenDetailsLike>;
      }
    ).getScreenDetails();

    return (
      details?.screens?.find((screen) => screen !== details.currentScreen) ??
      null
    );
  } catch {
    // 권한 거부·미지원 — 일반 팝업으로 폴백한다.
    return null;
  }
}

function featuresFor(screen: ScreenLike): string {
  return [
    `left=${screen.availLeft ?? 0}`,
    `top=${screen.availTop ?? 0}`,
    `width=${screen.availWidth ?? 1280}`,
    `height=${screen.availHeight ?? 720}`,
  ].join(",");
}

/**
 * 청중 송출 창을 연다. 같은 창 이름을 쓰므로 이미 열려 있으면 그 창을 재사용한다.
 */
export async function openAudienceWindow(
  presentationId: string,
): Promise<AudienceWindowResult> {
  const url = buildAudienceUrl(presentationId);
  const secondary = await findSecondaryScreen();

  const opened = window.open(
    url,
    AUDIENCE_WINDOW_NAME,
    secondary ? featuresFor(secondary) : FALLBACK_FEATURES,
  );

  if (!opened) {
    return { status: "blocked", window: null, message: MESSAGES.blocked };
  }

  const status: AudienceWindowStatus = secondary ? "secondary" : "fallback";
  return { status, window: opened, message: MESSAGES[status] };
}
