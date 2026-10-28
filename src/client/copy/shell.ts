export const SHELL_COPY = {
  hydrating: "프레젠테이션을 불러오는 중…",
  routeLoading: "불러오는 중…",
  backgroundGallery: "배경 갤러리",
  pageTitle: {
    editor: "프레젠테이션 편집",
    projection: "송출",
    share: "공유 프레젠테이션",
  },
  mainNav: "주 메뉴",
  notifications: "알림",
  skipToContent: "본문으로 건너뛰기",
  signOut: "로그아웃",
  signingOut: "로그아웃 중…",
  landingEnter: "내 프레젠테이션으로 이동",
  searchPlaceholder: {
    trash: "휴지통에서 검색",
    drive: "폴더, 프레젠테이션, 곡 제목, 가사로 검색",
  },
  unsupportedBrowser:
    "이 브라우저에서는 열 수 없어요. iPhone·iPad는 iOS 16.4 이상으로 업데이트하거나, 최신 Chrome·Edge·Safari·Firefox에서 열어 주세요.",
  browserSupport: {
    label: "브라우저 호환성 안내",
    title: "이 브라우저에선 일부 기능을 쓸 수 없어요",
    description: (missing: string) =>
      `${missing} 기능을 지원하지 않아요. 송출은 최신 데스크톱 Chrome, Edge, Safari, Firefox에서 해 주세요.`,
    outdated: {
      title: "이 브라우저에선 화면이 제대로 보이지 않아요",
      description:
        "고른 항목과 삭제 버튼의 글자가 보이지 않을 수 있어요. 브라우저를 최신 버전으로 업데이트하고, Windows 7·8.1이라 업데이트할 수 없으면 Firefox로 열어 주세요.",
    },
    dismiss: "안내 배너 닫기",
    capabilities: {
      fullscreen: "전체화면 송출",
      h264: "배경 영상(H.264) 재생",
      wakeLock: "화면 꺼짐 방지",
      offline: "오프라인 송출",
    },
  },
  routeError: {
    title: "화면을 불러오지 못했어요",
    description: "인터넷 연결을 확인하고 새로고침해 주세요.",
    reload: "새로고침",
  },
  rootError: {
    description: "새로고침해 주세요.",
  },
  storage: {
    saveFailed: "저장하지 못했어요",
    corrupted: (count: number) => `저장본 ${count}개를 열지 못했어요`,
    corruptedHint:
      "지우지 않고 보관해 두었어요. 복구가 필요하면 문의해 주세요.",
    clearMedia: "저장한 배경 영상 지우기",
    mediaCleared: (count: number) =>
      `배경 영상 ${count}개를 지웠어요. 잠시 뒤 다시 저장해요.`,
    noMediaToClear: "지울 배경 영상이 없어요. 기기 저장 공간을 비워 주세요.",
  },
  storagePersistence: {
    title: "오프라인 저장본이 지워질 수 있어요",
    description:
      "기기 저장 공간이 부족하면 브라우저가 이 기기에 저장한 프레젠테이션과 배경을 지울 수 있어요. 앱으로 설치하면 지워지지 않아요.",
    dismiss: "오프라인 저장본 안내 닫기",
  },
  theme: {
    title: "테마 설정",
    current: (label: string) => `테마 설정: ${label}`,
    light: { label: "라이트 모드", description: "밝은 화면 테마" },
    dark: { label: "다크 모드", description: "어두운 화면 테마" },
    system: { label: "시스템 설정", description: "기기 설정에 맞춤" },
  },
} as const;
