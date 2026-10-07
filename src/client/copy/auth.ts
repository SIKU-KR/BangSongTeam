import { APP_NAME } from "#shared";

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
  cancel: "로그인 없이 돌아가기",
  optimizedFor: "데스크톱 Chrome에서 가장 잘 동작해요",
  sessionCheckFailed: "서버에 연결하지 못했어요",
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
