import { z } from "zod";
import { NOONNU_SUPPORTED_FONT_NAMES } from "../constants/noonnuFonts";

/**
 * 3x3 격자 앵커 프리셋
 */
export const GridAnchorPresetSchema = z.enum([
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
  "custom",
]);
export type GridAnchorPreset = z.infer<typeof GridAnchorPresetSchema>;

/**
 * 슬라이드 텍스트 박스 위치 및 크기 (%)
 * 16:9 가상 스테이지(1920x1080) 기준 퍼센트 (0 ~ 100)
 */
export const TextBoxPositionSchema = z.object({
  anchor: GridAnchorPresetSchema.default("middle-center"),
  xPercent: z.number().min(5).max(95).default(50),
  yPercent: z.number().min(5).max(95).default(50),
  widthPercent: z.number().min(20).max(90).default(80),
});
export type TextBoxPosition = z.infer<typeof TextBoxPositionSchema>;

const HexColorSchema = z.string().regex(/^#([0-9a-fA-F]{3}){1,2}$/);

/**
 * 가사 줄마다 글자 뒤에만 까는 검정 박스. 화면 전체를 덮는 오버레이와 따로 켠다.
 * 여백·둥글기는 글자 크기 대비 %라 글자 크기를 바꿔도 비율이 그대로다.
 */
export const TextBackdropSchema = z.object({
  enabled: z.boolean().default(false),
  opacity: z.number().min(0).max(100).default(60),
  paddingPercent: z.number().min(0).max(60).default(20),
  radiusPercent: z.number().min(0).max(60).default(15),
});
export type TextBackdrop = z.infer<typeof TextBackdropSchema>;

/**
 * 곡(Deck) 단위 타이포그래피 및 가독성 스타일
 *
 * `backgroundColor`는 배경 영상·이미지가 없을 때 깔리는 단색이다. 한 번도 고르지
 * 않은 곡은 값이 없고 검정으로 그려진다. 값이 있으면 사용자가 단색을 고른 것이라
 * 프레젠테이션에 넣을 때 기본 배경을 입히지 않는다.
 */
export const DeckStyleSchema = z.object({
  overlayOpacity: z.number().min(0).max(100).default(40),
  overlayColor: HexColorSchema.default("#000000"),
  backgroundColor: HexColorSchema.optional(),
  textBackdrop: TextBackdropSchema.default({}),

  fontFamily: z.enum(NOONNU_SUPPORTED_FONT_NAMES).default("Pretendard"),
  fontSizeVw: z.number().min(2).max(10).default(4.2),
  fontColor: HexColorSchema.default("#FFFFFF"),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  lineHeight: z.number().min(1.0).max(2.5).default(1.4),

  textShadowLevel: z
    .enum(["none", "soft", "medium", "strong"])
    .default("medium"),

  position: TextBoxPositionSchema.default({
    anchor: "middle-center",
    xPercent: 50,
    yPercent: 50,
    widthPercent: 80,
  }),
});
export type DeckStyle = z.infer<typeof DeckStyleSchema>;
