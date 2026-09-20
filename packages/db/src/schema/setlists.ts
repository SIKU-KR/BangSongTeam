import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { decks } from "./decks";

// ============================================================================
// 예배 콘티 (Setlist) 및 항목
// ============================================================================
export const setlists = sqliteTable(
  "setlists",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    serviceDate: text("service_date").notNull(), // 'YYYY-MM-DD'
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
  },
  (t) => [index("idx_setlists_user_date").on(t.userId, t.serviceDate)],
);

export const setlistItems = sqliteTable(
  "setlist_items",
  {
    id: text("id").primaryKey(),
    setlistId: text("setlist_id")
      .notNull()
      .references(() => setlists.id, { onDelete: "cascade" }),
    deckId: text("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
  },
  (t) => [
    index("idx_setlist_items_order").on(t.setlistId, t.order),
    uniqueIndex("idx_setlist_items_unique").on(t.setlistId, t.deckId),
  ],
);

export type Setlist = typeof setlists.$inferSelect;
export type NewSetlist = typeof setlists.$inferInsert;
export type SetlistItem = typeof setlistItems.$inferSelect;
export type NewSetlistItem = typeof setlistItems.$inferInsert;
