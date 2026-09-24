import {
  sqliteTable,
  text,
  integer,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";

/**
 * 드라이브 폴더 트리 인접 리스트.
 */
export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => folders.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    trashedAt: integer("trashed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_folders_user_parent").on(t.userId, t.parentId)],
);

export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;

/**
 * 오프라인 우선 동기화 시 삭제 상태 전파를 위한 영구 삭제 tombstone 기록.
 */
export const driveTombstones = sqliteTable(
  "drive_tombstones",
  {
    itemId: text("item_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["folder", "presentation"] }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_drive_tombstones_user").on(t.userId)],
);

export type DriveTombstone = typeof driveTombstones.$inferSelect;
