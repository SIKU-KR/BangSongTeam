import { z } from "zod";
import { IdSchema } from "./id";
import { PresentationDocumentSchema } from "./api";

/**
 * 세트 링크 공유 설정 (Google·Canva의 "일반 액세스").
 * `off`면 링크가 동작하지 않는다. 공유받은 사람은 보기·발표·사본 만들기만
 * 할 수 있고 원본은 고치지 못한다.
 */
export const LinkAccessSchema = z.enum(["off", "view"]);
export type LinkAccess = z.infer<typeof LinkAccessSchema>;

/** 링크 주소는 클라이언트가 자기 origin으로 만든다. */
export const ShareSettingsSchema = z.object({
  access: LinkAccessSchema,
  token: z.string().nullable(),
});
export type ShareSettings = z.infer<typeof ShareSettingsSchema>;

export const UpdateShareSettingsRequestSchema = z.object({
  access: LinkAccessSchema,
});
export type UpdateShareSettingsRequest = z.infer<
  typeof UpdateShareSettingsRequestSchema
>;

export const JoinShareResponseSchema = z.object({
  presentationId: IdSchema,
  role: z.enum(["owner", "viewer"]),
  document: PresentationDocumentSchema,
});
export type JoinShareResponse = z.infer<typeof JoinShareResponseSchema>;
