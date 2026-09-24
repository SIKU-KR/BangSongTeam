import { z } from "zod";
import { IdSchema } from "./id";

/**
 * 드라이브 폴더 (홈 `/presentations`).
 *
 * 실제 파일시스템처럼 `parentId`로 중첩된다. `null`이면 '내 드라이브' 루트다.
 * 휴지통은 소프트 삭제다 — `trashedAt`이 있으면 휴지통에 있고, 하위 항목은
 * 자기 `trashedAt`과 상관없이 함께 가려진다 (조상 기준 판정, `folderTree.ts`).
 */
export const FolderSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  parentId: IdSchema.nullable(),
  name: z.string().trim().min(1).max(100),
  trashedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Folder = z.infer<typeof FolderSchema>;

/**
 * 영구 삭제한 항목 id.
 *
 * 오프라인 병합은 '서버에 없는 로컬 항목 = 아직 안 올라간 항목'으로 보고 다시
 * 올린다. 이 목록에 있는 id는 다른 기기에서 영구 삭제된 것이므로 로컬에서도 지운다.
 */
export const DriveTombstonesSchema = z.object({
  folderIds: z.array(IdSchema),
  presentationIds: z.array(IdSchema),
});
export type DriveTombstones = z.infer<typeof DriveTombstonesSchema>;

/** 내 폴더 전체 목록 + 영구 삭제 기록 */
export const FolderListResponseSchema = z.object({
  folders: z.array(FolderSchema),
  tombstones: DriveTombstonesSchema,
});
export type FolderListResponse = z.infer<typeof FolderListResponseSchema>;

/**
 * 폴더 1건 저장 응답.
 *
 * 서버는 부모가 없거나 남의 것이거나 사이클을 만드는 이동을 루트로 보정한다.
 * 클라이언트는 이 확정본을 반영해야 한다.
 */
export const FolderUpsertResponseSchema = z.object({
  folder: FolderSchema,
});
export type FolderUpsertResponse = z.infer<typeof FolderUpsertResponseSchema>;

/** 폴더 영구 삭제 응답 — 함께 지워진 하위 폴더·프레젠테이션 id */
export const FolderDeleteResponseSchema = z.object({
  ok: z.literal(true),
  deletedFolderIds: z.array(IdSchema),
  deletedPresentationIds: z.array(IdSchema),
});
export type FolderDeleteResponse = z.infer<typeof FolderDeleteResponseSchema>;
