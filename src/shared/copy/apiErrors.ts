/**
 * Worker가 `{ error }`로 돌려주는 문장. 클라이언트는 이 문장을 그대로 토스트에
 * 띄운다(`describeApiError`).
 */
export const API_ERRORS = {
  loginRequired: "로그인이 필요합니다",
  adminOnly: "관리자만 할 수 있습니다",
  userNotFound: "사용자를 찾을 수 없습니다",
  deck: {
    idMismatch: "덱 id가 경로와 일치하지 않습니다",
    libraryOnly: "보관함 곡만 저장할 수 있습니다",
    notAccessible: "이 곡에 접근할 수 없습니다",
    saveFailed: "곡을 저장하지 못했습니다",
    publishFromLibrary: "세트에 담긴 곡은 보관함 원본으로 공개합니다",
    noSlides: "슬라이드가 없는 곡은 공개할 수 없습니다",
    takenDown: "운영자가 게시를 중단한 곡이라 다시 공개할 수 없습니다",
    notPublished: "공개된 곡을 찾을 수 없습니다",
  },
  folder: {
    idMismatch: "폴더 id가 경로와 일치하지 않습니다",
    notAccessible: "이 폴더에 접근할 수 없습니다",
    saveFailed: "폴더를 저장하지 못했습니다",
  },
  presentation: {
    idMismatch: "문서 id가 경로와 일치하지 않습니다",
    notAccessible: "이 프레젠테이션에 접근할 수 없습니다",
    saveFailed: "프레젠테이션을 저장하지 못했습니다",
    fullSyncRequired: "서버에 없는 곡이 있어 전체를 다시 보내야 합니다",
  },
  background: {
    invalidUpload: "업로드 형식이 올바르지 않습니다",
    unreadableFile:
      "파일 내용을 읽을 수 없습니다. MP4 영상이나 JPEG·PNG·WebP 이미지인지 확인해 주세요",
    unreadablePoster: "포스터 이미지를 읽을 수 없습니다",
    notFound: "배경을 찾을 수 없습니다",
  },
  report: {
    targetNotFound: "신고할 대상을 찾을 수 없습니다",
    alreadyPending: "이미 접수된 신고가 처리 중입니다",
  },
  share: {
    linkUnavailable: "링크가 만료되었거나 공유가 해제되었습니다",
  },
} as const;
