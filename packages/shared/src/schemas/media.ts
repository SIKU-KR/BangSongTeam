import { z } from "zod";

export const BackgroundMediaSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(100),
  r2Key: z.string(), // R2 내 파일 경로 (mp4)
  posterKey: z.string(), // 썸네일 경로 (webp)
  durationSec: z.number().positive(),
  license: z.string(),
  tags: z.array(z.string()), // ["잔잔한", "따뜻한"]
  cdnUrl: z.string().url(), // https://media.domain.com/loop_01.mp4
  posterUrl: z.string().url(),
});
export type BackgroundMedia = z.infer<typeof BackgroundMediaSchema>;
