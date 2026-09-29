export const SHELL_COPY = {
  hydrating: "프레젠테이션을 불러오는 중…",
  routeLoading: "불러오는 중…",
  backgroundGallery: "배경 갤러리",
  mainNav: "주 메뉴",
  skipToContent: "본문으로 건너뛰기",
  signOut: "로그아웃",
  signingOut: "로그아웃 중…",
  landingEnter: "내 프레젠테이션으로 이동",
  searchPlaceholder: {
    trash: "휴지통에서 검색",
    drive: "폴더, 프레젠테이션, 곡 제목, 가사로 검색",
    backgrounds: "배경 제목으로 검색",
  },
  update: {
    title: "새 버전이 나왔어요",
    description: "송출 중이 아닐 때 적용해 주세요.",
    apply: "지금 적용",
  },
  browserSupport: {
    label: "브라우저 호환성 안내",
    title: "이 브라우저에선 일부 기능을 쓸 수 없어요",
    description: (missing: string) =>
      `${missing} 기능을 지원하지 않아요. 송출은 최신 데스크톱 Chrome, Edge, Safari, Firefox에서 해 주세요.`,
    dismiss: "안내 배너 닫기",
    capabilities: {
      fullscreen: "전체화면 송출",
      h264: "배경 영상(H.264) 재생",
      offline: "오프라인 송출",
    },
  },
  routeError: {
    title: "화면을 불러오지 못했어요",
    description: "인터넷 연결을 확인하고 새로고침해 주세요.",
    reload: "새로고침",
  },
  storage: {
    saveFailed: "저장하지 못했어요",
    corrupted: (count: number) => `저장본 ${count}개를 열지 못했어요`,
    corruptedHint:
      "지우지 않고 보관해 두었어요. 복구가 필요하면 문의해 주세요.",
  },
  theme: {
    title: "테마 설정",
    current: (label: string) => `테마 설정: ${label}`,
    light: { label: "라이트 모드", description: "밝은 화면 테마" },
    dark: { label: "다크 모드", description: "어두운 화면 테마" },
    system: { label: "시스템 설정", description: "기기 설정에 맞춤" },
  },
} as const;
