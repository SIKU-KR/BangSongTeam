import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { folders } from "./folders";

/**
 * 프레젠테이션 머리. 담긴 곡은 `decks`의 사본 행(`presentation_id`)이다.
 */
export const presentations = sqliteTable(
  "presentations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    serviceDate: text("service_date").notNull(),
    folderId: text("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    trashedAt: integer("trashed_at", { mode: "timestamp_ms" }),
    linkAccess: text("link_access", { enum: ["off", "view"] })
      .notNull()
      .default("off"),
    linkToken: text("link_token"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    check("presentations_link_access", sql`${t.linkAccess} IN ('off', 'view')`),
    index("idx_presentations_user_date").on(t.userId, t.serviceDate),
    index("idx_presentations_user_folder").on(t.userId, t.folderId),
    uniqueIndex("idx_presentations_link_token").on(t.linkToken),
  ],
);

/**
 * 공유 링크로 세트를 연 사람 (보기 전용). 소유자가 링크를 끄면 접근을 잃고
 * 다시 켜면 되찾는다. 링크를 재설정하면 행을 모두 지워 접근을 끊는다.
 */
export const presentationMembers = sqliteTable(
  "presentation_members",
  {
    presentationId: text("presentation_id")
      .notNull()
      .references(() => presentations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.presentationId, t.userId] }),
    index("idx_presentation_members_user").on(t.userId),
  ],
);

export type Presentation = typeof presentations.$inferSelect;
export type NewPresentation = typeof presentations.$inferInsert;
export type PresentationMember = typeof presentationMembers.$inferSelect;
