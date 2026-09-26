import { z } from "zod";
import { IdSchema } from "./id";
import { MEDIA_URL_PREFIX } from "../constants/projection";
import {
  BACKGROUND_UPLOAD_LIMITS,
  isBackgroundImageMimeType,
  isBackgroundVideoMimeType,
} from "../constants/backgrounds";

export const BackgroundSourceSchema = z.enum(["service", "user"]);
export type BackgroundSource = z.infer<typeof BackgroundSourceSchema>;

export const BackgroundKindSchema = z.enum(["video", "image"]);
export type BackgroundKind = z.infer<typeof BackgroundKindSchema>;

const MediaUrlSchema = z.string().startsWith(MEDIA_URL_PREFIX);

/** `backgrounds.tags` JSON TEXT 컬럼의 형식 */
export const BackgroundTagsSchema = z.array(z.string());

/**
 * 클라이언트가 보는 배경 한 건.
 *
 * URL은 동일 출처 미디어 프록시(`/api/media/*`) 상대 경로다. 송출 화면은 이 값을
 * IndexedDB에서 읽어 그대로 재생하므로 서버에 다시 묻지 않는다.
 * `posterUrl`은 목록·썸네일용 축소본(폭 960px)이다. 포스터 없이 올라간 예전 이미지
 * 배경만 `mediaUrl`과 `posterUrl`이 같다 (운영 런북 1-4로 채운다).
 */
export const BackgroundMediaSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(BACKGROUND_UPLOAD_LIMITS.maxTitleLength),
  source: BackgroundSourceSchema,
  kind: BackgroundKindSchema,
  mediaUrl: MediaUrlSchema,
  posterUrl: MediaUrlSchema,
  durationSec: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  license: z.string(),
  tags: BackgroundTagsSchema,
  createdAt: z.string().datetime(),
});
export type BackgroundMedia = z.infer<typeof BackgroundMediaSchema>;

/**
 * 배경 목록 응답. 모든 배경이 한 갤러리에 모두에게 똑같이 보인다.
 * `canManage`는 이 요청의 세션이 관리자(`ADMIN_USER_IDS`)일 때만 true이고,
 * 화면은 이 값으로 올리기·삭제 버튼을 보여 줄지 정한다 (권한 검사는 서버가 한다).
 */
export const BackgroundListResponseSchema = z.object({
  backgrounds: z.array(BackgroundMediaSchema),
  canManage: z.boolean(),
});
export type BackgroundListResponse = z.infer<
  typeof BackgroundListResponseSchema
>;

const TagsFieldSchema = z
  .string()
  .optional()
  .transform((raw, ctx): string[] => {
    if (!raw) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "태그 형식이 올바르지 않습니다",
      });
      return z.NEVER;
    }
    const result = z
      .array(
        z.string().trim().min(1).max(BACKGROUND_UPLOAD_LIMITS.maxTagLength),
      )
      .max(BACKGROUND_UPLOAD_LIMITS.maxTags)
      .safeParse(parsed);
    if (!result.success) {
      ctx.addIssue({
        code: "custom",
        message: `태그는 ${BACKGROUND_UPLOAD_LIMITS.maxTags}개까지 붙일 수 있습니다`,
      });
      return z.NEVER;
    }
    return [...new Set(result.data)];
  });

/**
 * 관리자 배경 업로드 폼 (multipart). 올린 배경은 곧바로 기본 제공 배경이 된다.
 *
 * 선언된 MIME만 검사한다. 파일 앞부분 바이트로 실제 형식을 확인하는 것은
 * Worker가 맡는다 (`sniffBackgroundMimeType`). 영상은 첫 화면 포스터를 함께
 * 받아야 목록·썸네일이 영상을 내려받지 않고 그려진다. 이미지도 축소 포스터를
 * 받는다(선택). 없으면 최대 30MB 원본이 썸네일마다 디코딩된다.
 */
export const BackgroundUploadFormSchema = z
  .object({
    file: z.instanceof(File),
    poster: z.instanceof(File).optional(),
    title: z
      .string()
      .trim()
      .min(1, "배경 제목을 입력해 주세요")
      .max(BACKGROUND_UPLOAD_LIMITS.maxTitleLength),
    license: z
      .string()
      .trim()
      .min(1, "출처와 라이선스를 적어 주세요")
      .max(BACKGROUND_UPLOAD_LIMITS.maxLicenseLength),
    tags: TagsFieldSchema,
    durationSec: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .transform((raw) => (raw ? Number(raw) : 0))
      .pipe(
        z.number().int().min(0).max(BACKGROUND_UPLOAD_LIMITS.maxDurationSec),
      ),
    acceptedRightsNotice: z.literal("true", {
      errorMap: () => ({
        message: "모든 사용자에게 배포해도 되는 라이선스인지 확인해 주세요",
      }),
    }),
  })
  .superRefine((form, ctx) => {
    const isVideo = isBackgroundVideoMimeType(form.file.type);
    if (!isVideo && !isBackgroundImageMimeType(form.file.type)) {
      ctx.addIssue({
        code: "custom",
        path: ["file"],
        message: "MP4 영상이나 JPEG·PNG·WebP 이미지만 올릴 수 있습니다",
      });
    }
    if (form.file.size === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["file"],
        message: "빈 파일은 올릴 수 없습니다",
      });
    }
    if (form.file.size > BACKGROUND_UPLOAD_LIMITS.maxFileBytes) {
      ctx.addIssue({
        code: "custom",
        path: ["file"],
        message: "파일 하나는 30MB 이하만 올릴 수 있습니다",
      });
    }
    if (isVideo && !form.poster) {
      ctx.addIssue({
        code: "custom",
        path: ["poster"],
        message: "영상 배경은 포스터 이미지가 필요합니다",
      });
    }
    if (form.poster) {
      if (!isBackgroundImageMimeType(form.poster.type)) {
        ctx.addIssue({
          code: "custom",
          path: ["poster"],
          message: "포스터는 JPEG·PNG·WebP 이미지여야 합니다",
        });
      }
      if (form.poster.size > BACKGROUND_UPLOAD_LIMITS.maxPosterBytes) {
        ctx.addIssue({
          code: "custom",
          path: ["poster"],
          message: "포스터 이미지는 2MB 이하여야 합니다",
        });
      }
    }
  });
export type BackgroundUploadForm = z.infer<typeof BackgroundUploadFormSchema>;

export const BackgroundIdParamSchema = z.object({ id: IdSchema });

export const BackgroundUploadResponseSchema = z.object({
  background: BackgroundMediaSchema,
});
export type BackgroundUploadResponse = z.infer<
  typeof BackgroundUploadResponseSchema
>;

export const BackgroundDeleteResponseSchema = z.object({
  ok: z.literal(true),
});
export type BackgroundDeleteResponse = z.infer<
  typeof BackgroundDeleteResponseSchema
>;
