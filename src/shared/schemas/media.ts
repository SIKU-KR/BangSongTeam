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
 * 이미지 배경은 `mediaUrl`과 `posterUrl`이 같다.
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

export const BackgroundStorageUsageSchema = z.object({
  usedBytes: z.number().int().nonnegative(),
  limitBytes: z.number().int().positive(),
});
export type BackgroundStorageUsage = z.infer<
  typeof BackgroundStorageUsageSchema
>;

/** 로그인하지 않았으면 사전 주입 배경만 오고 `usage`는 null이다 */
export const BackgroundListResponseSchema = z.object({
  backgrounds: z.array(BackgroundMediaSchema),
  usage: BackgroundStorageUsageSchema.nullable(),
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
 * 커스텀 배경 업로드 폼 (multipart).
 *
 * 선언된 MIME만 검사한다. 파일 앞부분 바이트로 실제 형식을 확인하는 것은
 * Worker가 맡는다 (`sniffBackgroundMimeType`). 영상은 첫 화면 포스터를 함께
 * 받아야 목록·썸네일이 영상을 내려받지 않고 그려진다.
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
        message: "권리를 가졌거나 사용 허락을 받은 파일인지 확인해 주세요",
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
  usage: BackgroundStorageUsageSchema,
});
export type BackgroundUploadResponse = z.infer<
  typeof BackgroundUploadResponseSchema
>;

export const BackgroundDeleteResponseSchema = z.object({
  ok: z.literal(true),
  usage: BackgroundStorageUsageSchema,
});
export type BackgroundDeleteResponse = z.infer<
  typeof BackgroundDeleteResponseSchema
>;
