import {
  sqliteTable,
  text,
  integer,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";

// ============================================================================
// 드라이브 폴더 (홈 `/presentations`의 폴더 트리)
//
// 인접 리스트(`parent_id`)로 중첩한다. `parent_id`가 NULL이면 '내 드라이브' 루트.
// 휴지통은 소프트 삭제(`trashed_at`)다. 하위 항목은 조상 기준으로 함께 가려지므로
// 따로 표시하지 않는다.
//
// 시각은 ms 정밀도로 둔다. 클라이언트가 LWW 병합에 쓰는 ISO 문자열에는 ms가 있어서,
// 초 단위로 잘리면 로컬이 늘 더 최신으로 보여 부팅할 때마다 다시 올린다.
// ============================================================================
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

// ============================================================================
// 영구 삭제 기록 (tombstone)
//
// 오프라인 우선 병합은 '서버에 없는 로컬 항목 = 아직 안 올라간 항목'으로 보고
// 다시 올린다. 그대로 두면 한 기기에서 휴지통을 비워도 다른 기기가 다음 부팅에
// 되살린다. 영구 삭제한 id를 남겨 두고 병합이 이를 보고 로컬에서도 지우게 한다.
// 같은 id를 다시 저장하면(삭제 뒤 편집) 기록을 지우고 되살린다.
// ============================================================================
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
