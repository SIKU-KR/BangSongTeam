/**
 * Worker가 `{ error }`로 돌려주는 문장. 클라이언트는 이 문장을 그대로 토스트에
 * 띄운다(`describeApiError`).
 */
export const API_ERRORS = {
  loginRequired: "로그인이 필요해요",
  userNotFound: "사용자를 찾을 수 없어요",
  idMismatch: "요청이 올바르지 않아요. 새로고침한 뒤 다시 시도해 주세요",
  deck: {
    libraryOnly: "보관함 곡만 저장할 수 있어요",
    notAccessible: "이 곡을 열 수 없어요",
    saveFailed: "곡을 저장하지 못했어요",
    publishFromLibrary: "보관함에 있는 곡만 공개할 수 있어요",
    noSlides: "슬라이드가 한 장 이상 있어야 공개할 수 있어요",
    takenDown: "운영자가 게시를 중단한 곡이라 다시 공개할 수 없어요",
    notPublished: "공개된 곡을 찾을 수 없어요",
  },
  folder: {
    notAccessible: "이 폴더를 열 수 없어요",
    saveFailed: "폴더를 저장하지 못했어요",
  },
  presentation: {
    notAccessible: "이 프레젠테이션을 열 수 없어요",
    saveFailed: "프레젠테이션을 저장하지 못했어요",
    fullSyncRequired:
      "서버에 없는 곡이 있어 프레젠테이션 전체를 다시 보내야 해요",
  },
  report: {
    targetNotFound: "신고할 곡을 찾을 수 없어요",
    alreadyPending: "이미 보낸 신고를 확인하고 있어요",
  },
  media: {
    keyRequired: "배경 파일을 지정해 주세요",
    notFound: "배경 파일을 찾을 수 없어요",
  },
  share: {
    linkUnavailable: "링크가 만료되었거나 공유가 해제됐어요",
  },
} as const;
