import { z } from "zod";
import { IdSchema } from "./id";

export const BackgroundMediaSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(100),
  r2Key: z.string(),
  posterKey: z.string(),
  durationSec: z.number().positive(),
  license: z.string(),
  tags: z.array(z.string()),
  cdnUrl: z.string().url(),
  posterUrl: z.string().url(),
});
export type BackgroundMedia = z.infer<typeof BackgroundMediaSchema>;

export const BackgroundsQuerySchema = z.object({
  q: z.string().trim().max(50).optional(),
  tag: z.string().trim().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type BackgroundsQuery = z.infer<typeof BackgroundsQuerySchema>;
