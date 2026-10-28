/**
 * API 서버가 `{ error }`로 돌려주는 문장. 클라이언트는 이 문장을 그대로 토스트에
 * 띄운다(`describeApiError`).
 *
 * `auth`는 Better Auth 오류 본문(`{ code, message }`)의 `message`다. 로그인 화면은 이 문장 대신
 * `code`와 상태로 고른 문구를 보여 준다.
 */
export const API_ERRORS = {
  loginRequired: "로그인이 필요해요",
  consentRequired:
    "이용 동의를 마쳐야 쓸 수 있어요. 동의한 뒤 다시 시도해 주세요",
  userNotFound: "사용자를 찾을 수 없어요",
  idMismatch: "요청이 올바르지 않아요. 새로고침한 뒤 다시 시도해 주세요",
  tooManyRequests: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요",
  requestFailed: "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요",
  serverBusy: "서버가 잠시 바빠요. 잠시 후 다시 시도해 주세요",
  notFound: "요청한 기능을 찾을 수 없어요. 새로고침한 뒤 다시 시도해 주세요",
  payloadTooLarge: "보낸 내용이 너무 커요. 줄여서 다시 보내 주세요",
  auth: {
    signUpInProgress:
      "이 이메일로 가입하는 중이에요. 잠시 후 다시 시도해 주세요",
  },
  deck: {
    libraryOnly: "보관함 곡만 저장할 수 있어요",
    notAccessible: "이 곡을 열 수 없어요",
    saveFailed: "곡을 저장하지 못했어요",
    publishFromLibrary: "보관함에 있는 곡만 공개할 수 있어요",
    noSlides: "슬라이드가 한 장 이상 있어야 공개할 수 있어요",
    takenDown: "운영자가 게시를 중단한 곡이라 다시 공개할 수 없어요",
    notPublished: "공개된 곡을 찾을 수 없어요",
    tooLarge: "가사가 너무 길어요. 가사를 나눠 여러 곡으로 만들어 주세요",
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
    songTooLarge: (title: string) =>
      `‘${title}’ 곡이 너무 커요. 프레젠테이션에서 이 곡을 빼 주세요`,
    tooLarge:
      "프레젠테이션이 너무 커요. 곡을 몇 개 빼거나 프레젠테이션을 나눠 주세요",
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
