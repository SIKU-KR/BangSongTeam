import { z } from "zod";

export const CatalogStatusSchema = z.enum(["single", "normalized", "locked"]);
export type CatalogStatus = z.infer<typeof CatalogStatusSchema>;

export const LyricCatalogSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(100),
  artist: z.string().max(100).default(""),
  titleNorm: z.string(),
  artistNorm: z.string(),
  lyricsCanonical: z.string(),
  versionCount: z.number().int().nonnegative().default(1),
  status: CatalogStatusSchema.default("single"),
  normalizedAt: z.string().datetime().nullable(),
});
export type LyricCatalog = z.infer<typeof LyricCatalogSchema>;
