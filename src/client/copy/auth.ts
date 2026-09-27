import { APP_NAME } from "#shared";

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
  defaultDescription:
    "로그인하면 만든 세트가 계정에 저장되어, 교회 PC와 집 PC 어디서든 같은 세트를 열 수 있습니다.",
  signInFailed: "로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  loadingProviders: "로그인 수단을 확인하는 중…",
  noProviders:
    "사용 가능한 로그인 수단이 없습니다. 소셜 로그인 자격증명이 설정되지 않았습니다.",
  cancel: "로그인하지 않고 돌아가기",
  optimizedFor: "데스크톱 Chrome에 최적화되어 있습니다",
  sessionCheckFailed: "세션 확인 실패: 서버에 닿지 못했습니다",
  configLoadFailed: "로그인 설정을 읽지 못했습니다",
  consent: {
    title: `${APP_NAME} 이용 동의`,
    description: "서비스를 시작하려면 아래 필수 항목에 동의해 주세요.",
    all: "전체 동의",
    ageOver14: "[필수] 만 14세 이상입니다",
    terms: `[필수] ${LEGAL_COPY.terms} 동의`,
    privacy: "[필수] 개인정보 수집·이용 동의",
    view: "보기",
    decline: "동의하지 않음",
    agree: "동의하고 시작하기",
    saving: "저장하는 중…",
  },
} as const;
