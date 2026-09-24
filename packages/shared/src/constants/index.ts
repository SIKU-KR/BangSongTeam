import { GridAnchorPreset, TextBoxPosition } from "../schemas/style";

/**
 * 지원하는 한글 및 영문 기본 웹폰트 목록
 */
export const SUPPORTED_FONTS = [
  "Pretendard",
  "Noto Sans KR",
  "Nanum Myeongjo",
  "Gmarket Sans",
  "KoPubWorld Batang",
] as const;
export type SupportedFont = (typeof SUPPORTED_FONTS)[number];

/**
 * 3x3 격자 앵커 프리셋별 기본 좌표 및 크기 정의 (16:9 가상 스테이지 기준 %)
 */
export const GRID_ANCHOR_PRESET_COORDINATES: Record<
  Exclude<GridAnchorPreset, "custom">,
  Omit<TextBoxPosition, "anchor">
> = {
  "top-left": { xPercent: 10, yPercent: 10, widthPercent: 80 },
  "top-center": { xPercent: 50, yPercent: 10, widthPercent: 80 },
  "top-right": { xPercent: 90, yPercent: 10, widthPercent: 80 },
  "middle-left": { xPercent: 10, yPercent: 50, widthPercent: 80 },
  "middle-center": { xPercent: 50, yPercent: 50, widthPercent: 80 },
  "middle-right": { xPercent: 90, yPercent: 50, widthPercent: 80 },
  "bottom-left": { xPercent: 10, yPercent: 90, widthPercent: 80 },
  "bottom-center": { xPercent: 50, yPercent: 90, widthPercent: 80 },
  "bottom-right": { xPercent: 90, yPercent: 90, widthPercent: 80 },
};

/**
 * 3x3 앵커 기준 CSS transform 오프셋 정의
 */
export const GRID_ANCHOR_TRANSFORMS: Record<
  Exclude<GridAnchorPreset, "custom">,
  string
> = {
  "top-left": "translate(0, 0)",
  "top-center": "translate(-50%, 0)",
  "top-right": "translate(-100%, 0)",
  "middle-left": "translate(0, -50%)",
  "middle-center": "translate(-50%, -50%)",
  "middle-right": "translate(-100%, -50%)",
  "bottom-left": "translate(0, -100%)",
  "bottom-center": "translate(-50%, -100%)",
  "bottom-right": "translate(-100%, -100%)",
};

/**
 * 텍스트 그림자(Text Shadow) 강도별 CSS 프리셋 (가독성 보장)
 */
export const TEXT_SHADOW_PRESETS = {
  none: "none",
  soft: "0 1px 4px rgba(0, 0, 0, 0.6)",
  medium: "0 2px 8px rgba(0, 0, 0, 0.8), 0 0 2px rgba(0, 0, 0, 0.9)",
  strong: "0 4px 12px rgba(0, 0, 0, 0.95), 0 0 4px rgba(0, 0, 0, 1)",
} as const;
export type TextShadowLevel = keyof typeof TEXT_SHADOW_PRESETS;

/**
 * 기본 텍스트 박스 위치 설정
 */
export const DEFAULT_TEXT_BOX_POSITION: TextBoxPosition = {
  anchor: "middle-center",
  xPercent: 50,
  yPercent: 50,
  widthPercent: 80,
};

/**
 * 기본 덱 스타일 상수
 */
export const DEFAULT_DECK_STYLE = {
  overlayOpacity: 40,
  overlayColor: "#000000",
  fontFamily: "Pretendard" as const,
  fontSizeVw: 4.2,
  fontColor: "#FFFFFF",
  textAlign: "center" as const,
  lineHeight: 1.4,
  textShadowLevel: "medium" as const,
  position: DEFAULT_TEXT_BOX_POSITION,
};

/**
 * 프레젠테이션 송출 단축키 정의
 */
export const PRESENTATION_SHORTCUTS = {
  NEXT_SLIDE: ["ArrowRight", "Space", "PageDown"],
  PREV_SLIDE: ["ArrowLeft", "PageUp"],
  TOGGLE_BLACKOUT: ["b", "B"],
  TOGGLE_LYRICS_HIDDEN: ["h", "H"],
  BUFFER_CLEAR_TIMEOUT_MS: 3000,
} as const;

/**
 * 텍스트 박스 이동 제한 안전 여백 (%)
 */
export const SAFE_MARGIN_PERCENT = {
  MIN_X: 5,
  MAX_X: 95,
  MIN_Y: 5,
  MAX_Y: 95,
  MIN_WIDTH: 20,
  MAX_WIDTH: 90,
} as const;

export * from "./backgrounds";

export * from "./projection";
