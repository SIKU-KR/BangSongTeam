import { z } from "zod";
import { DeckSchema } from "./deck";

export const SetlistItemSchema = z.object({
  id: z.string().uuid(),
  setlistId: z.string().uuid(),
  deckId: z.string().uuid(),
  order: z.number().int().nonnegative(),
  deck: DeckSchema.optional(), // Hydrated relation
});
export type SetlistItem = z.infer<typeof SetlistItemSchema>;

export const SetlistSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1).max(100),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  items: z.array(SetlistItemSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Setlist = z.infer<typeof SetlistSchema>;
