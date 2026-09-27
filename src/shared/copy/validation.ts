import { BACKGROUND_UPLOAD_LIMITS } from "../constants/backgrounds";

export const VALIDATION_COPY = {
  background: {
    invalidTags: "태그 형식이 올바르지 않습니다",
    tooManyTags: `태그는 ${BACKGROUND_UPLOAD_LIMITS.maxTags}개까지 붙일 수 있습니다`,
    titleRequired: "배경 제목을 입력해 주세요",
    licenseRequired: "출처와 라이선스를 적어 주세요",
    rightsNotice: "모든 사용자에게 배포해도 되는 라이선스인지 확인해 주세요",
    unsupportedType: "MP4 영상이나 JPEG·PNG·WebP 이미지만 올릴 수 있습니다",
    emptyFile: "빈 파일은 올릴 수 없습니다",
    fileTooLarge: "파일 하나는 30MB 이하만 올릴 수 있습니다",
    posterRequired: "영상 배경은 포스터 이미지가 필요합니다",
    posterType: "포스터는 JPEG·PNG·WebP 이미지여야 합니다",
    posterTooLarge: "포스터 이미지는 2MB 이하여야 합니다",
  },
} as const;
