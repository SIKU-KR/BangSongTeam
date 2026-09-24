import { z } from "zod";
import { IdSchema } from "./id";
import { DeckSchema } from "./deck";

export const PresentationItemSchema = z.object({
  id: IdSchema,
  presentationId: IdSchema,
  deckId: IdSchema,
  order: z.number().int().nonnegative(),
  deck: DeckSchema.optional(),
});
export type PresentationItem = z.infer<typeof PresentationItemSchema>;

export const PresentationSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  title: z.string().min(1).max(100),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(PresentationItemSchema).default([]),

  folderId: IdSchema.nullable().optional(),
  trashedAt: z.string().datetime().nullable().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Presentation = z.infer<typeof PresentationSchema>;
