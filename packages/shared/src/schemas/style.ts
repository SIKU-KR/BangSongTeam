import { z } from "zod";

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
  xPercent: z.number().min(5).max(95).default(50), // 앵커 X 좌표
  yPercent: z.number().min(5).max(95).default(50), // 앵커 Y 좌표
  widthPercent: z.number().min(20).max(90).default(80), // 텍스트 박스 최대 가로폭
});
export type TextBoxPosition = z.infer<typeof TextBoxPositionSchema>;

/**
 * 곡(Deck) 단위 타이포그래피 및 가독성 스타일
 */
export const DeckStyleSchema = z.object({
  // 오버레이 설정
  overlayOpacity: z.number().min(0).max(100).default(40), // 0 ~ 100%
  overlayColor: z
    .string()
    .regex(/^#([0-9a-fA-F]{3}){1,2}$/)
    .default("#000000"),

  // 폰트 및 텍스트 설정
  fontFamily: z
    .enum([
      "Pretendard",
      "Noto Sans KR",
      "Nanum Myeongjo",
      "Gmarket Sans",
      "KoPubWorld Batang",
    ])
    .default("Pretendard"),
  fontSizeVw: z.number().min(2).max(10).default(4.2), // 16:9 기준 상대 폰트 크기
  fontColor: z
    .string()
    .regex(/^#([0-9a-fA-F]{3}){1,2}$/)
    .default("#FFFFFF"),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  lineHeight: z.number().min(1.0).max(2.5).default(1.4),

  // 그림자 (가독성 핵심)
  textShadowLevel: z
    .enum(["none", "soft", "medium", "strong"])
    .default("medium"),

  // 텍스트 박스 위치
  position: TextBoxPositionSchema.default({
    anchor: "middle-center",
    xPercent: 50,
    yPercent: 50,
    widthPercent: 80,
  }),
});
export type DeckStyle = z.infer<typeof DeckStyleSchema>;
