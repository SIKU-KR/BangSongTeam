import { z } from "zod";
import { IdSchema } from "./id";

/** 폴더 이름 최대 길이. 클라이언트 입력 검증과 서버 스키마가 같은 한도를 쓴다 */
export const MAX_FOLDER_NAME_LENGTH = 100;

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
  name: z.string().trim().min(1).max(MAX_FOLDER_NAME_LENGTH),
  trashedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
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

/**
 * 폴더 영구 삭제 요청 본문.
 *
 * 새 클라이언트는 `expected`에 지우려는 하위 트리(그 기기가 본 폴더·프레젠테이션 id)를 담는다.
 * 서버 트리에 그 밖의 항목이 있으면 그 기기가 보지 못한 항목(다른 기기에서 옮겨 넣은 프레젠테이션 등)이라
 * 아무것도 지우지 않고 409로 답한다. 목록은 포함 여부를 볼 때만 쓰고, 가져온 데이터의 id는 형식을
 * 검사한 적이 없어 아무 문자열이나 받는다. 형식이 다른 id 하나 때문에 400이 나면 그 폴더는 영영
 * 지울 수 없다. 이전 클라이언트는 본문을 보내지 않으므로 휴지통 확인만 받는다.
 */
export const FolderDeleteRequestSchema = z.object({
  expected: z
    .object({
      folderIds: z.array(z.string()),
      presentationIds: z.array(z.string()),
    })
    .optional(),
});
export type FolderDeleteRequest = z.infer<typeof FolderDeleteRequestSchema>;

/**
 * 폴더 영구 삭제 응답 — 함께 지워진 하위 폴더·프레젠테이션 id.
 *
 * id 형식은 보지 않는다. 가져온 데이터의 id는 형식을 검사한 적이 없어, 엄격히 읽으면 서버가
 * 이미 끝낸 삭제를 실패로 알리고 로컬에서 지우지 않는다.
 */
export const FolderDeleteResponseSchema = z.object({
  ok: z.literal(true),
  deletedFolderIds: z.array(z.string()),
  deletedPresentationIds: z.array(z.string()),
});
export type FolderDeleteResponse = z.infer<typeof FolderDeleteResponseSchema>;
