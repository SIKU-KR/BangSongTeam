import { API_ERRORS, APP_NAME } from "#shared";

/**
 * 운영 브랜드. 법인도 개인사업자도 아니라 계약 주체가 될 수 없으므로,
 * 약관·처리방침에서는 늘 {@link OPERATOR_NAME}과 함께 적는다.
 */
export const OPERATOR_BRAND = "시쿠랩스";

/** 운영자이자 개인정보 보호책임자. 권리 행사·게시 중단 요청을 받는 창구다. */
export const OPERATOR_NAME = "박범식";
export const OPERATOR_EMAIL = "peter012677@naver.com";

export const LEGAL_COPY = {
  terms: "이용약관",
  privacy: "개인정보 처리방침",
  effectiveDate: (date: string) => `시행일: ${date}`,
} as const;

export const AUTH_COPY = {
  providers: {
    kakao: "카카오 로그인",
    naver: "네이버 로그인",
    google: "Google 계정으로 로그인",
  },
  defaultDescription: "로그인하면 교회와 집 어디서든 이어서 작업할 수 있어요.",
  signInFailed: "로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.",
  providerUnavailable:
    "지금은 이 방법으로 로그인할 수 없어요. 다른 방법으로 로그인해 주세요.",
  oauthErrors: {
    accountNotLinked:
      "같은 이메일로 가입한 계정이 있어요. 가입할 때 쓴 방법으로 로그인해 주세요.",
    stateExpired: "로그인 시간이 지났어요. 다시 시도해 주세요.",
  },
  inAppBrowser: {
    notice:
      "카카오톡 같은 앱 안에서는 Google 로그인을 쓸 수 없어요. Chrome이나 Safari에서 열어 주세요.",
    openExternal: "다른 브라우저로 열기",
    copyLink: "링크 복사",
  },
  signOutFailed:
    "로그아웃하지 못했어요. 인터넷에 연결한 뒤 다시 시도해 주세요.",
  cancel: "로그인 없이 돌아가기",
  optimizedFor: "데스크톱 Chrome에서 가장 잘 동작해요",
  sessionCheckFailed: "서버에 연결하지 못했어요",
  email: {
    modeLabel: "이메일 로그인 방식",
    signIn: "로그인",
    signUp: "가입",
    name: "이름",
    emailField: "이메일",
    password: "비밀번호",
    passwordHint: (min: number) => `${min}자 이상 입력해 주세요.`,
    submitSignIn: "이메일로 로그인",
    submitSignUp: "가입하기",
    pendingSignIn: "로그인하는 중…",
    pendingSignUp: "가입하는 중…",
    divider: "또는",
    invalidName: "이름을 입력해 주세요.",
    invalidEmail: "이메일 형식을 확인해 주세요.",
    invalidPassword: (min: number, max: number) =>
      `비밀번호는 ${min}자 이상 ${max}자 이하로 입력해 주세요.`,
    failures: {
      invalidCredentials: "이메일 또는 비밀번호를 확인해 주세요.",
      alreadyExists:
        "이미 가입한 이메일이에요. 가입할 때 쓴 방법으로 로그인해 주세요.",
      invalidInput: "입력한 내용을 확인한 뒤 다시 시도해 주세요.",
      rateLimited: "시도가 너무 많아요. 잠시 후 다시 시도해 주세요.",
      dailySignUpLimit: API_ERRORS.auth.dailySignUpLimit,
      network: "서버에 연결하지 못했어요. 네트워크를 확인해 주세요.",
      unknown: "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    },
  },
  dev: {
    title: "개발용 계정",
    signInAs: (name: string) => `${name} 계정으로 로그인`,
    consentPending: "약관 동의 전",
  },
  consent: {
    title: `${APP_NAME} 이용 동의`,
    description: "시작하려면 필수 항목에 동의해 주세요.",
    all: "전체 동의",
    ageOver14: "[필수] 만 14세 이상이에요",
    terms: `[필수] ${LEGAL_COPY.terms} 동의`,
    privacy: "[필수] 개인정보 수집·이용 동의",
    view: "보기",
    decline: "동의하지 않음",
    agree: "동의하고 시작하기",
    saving: "저장하는 중…",
  },
} as const;
