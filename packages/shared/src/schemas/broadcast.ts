import { z } from "zod";

export const BroadcastMessageSchema = z.discriminatedUnion("type", [
  // 1. 송출 창 준비 완료 신호
  z.object({
    type: z.literal("AUDIENCE_MOUNTED"),
    timestamp: z.number(),
  }),
  // 2. 조작 창에서 송출 창으로 전체 상태 주입 (스냅샷)
  z.object({
    type: z.literal("SYNC_SNAPSHOT"),
    timestamp: z.number(),
    payload: z.object({
      setlistId: z.string().uuid(),
      currentSongIndex: z.number().int().nonnegative(),
      currentSlideIndex: z.number().int().nonnegative(),
      isBlackout: z.boolean(),
      isLyricsHidden: z.boolean(),
    }),
  }),
  // 3. 슬라이드 직접 이동
  z.object({
    type: z.literal("NAVIGATE_SLIDE"),
    timestamp: z.number(),
    payload: z.object({
      songIndex: z.number().int().nonnegative(),
      slideIndex: z.number().int().nonnegative(),
    }),
  }),
  // 4. 긴급 블랙아웃 토글
  z.object({
    type: z.literal("SET_BLACKOUT"),
    timestamp: z.number(),
    payload: z.object({
      isBlackout: z.boolean(),
    }),
  }),
  // 5. 가사 숨기기 (배경 유지)
  z.object({
    type: z.literal("SET_LYRICS_HIDDEN"),
    timestamp: z.number(),
    payload: z.object({
      isLyricsHidden: z.boolean(),
    }),
  }),
  // 6. 하트비트 / 핑퐁
  z.object({
    type: z.literal("HEARTBEAT"),
    timestamp: z.number(),
  }),
]);
export type BroadcastMessage = z.infer<typeof BroadcastMessageSchema>;
