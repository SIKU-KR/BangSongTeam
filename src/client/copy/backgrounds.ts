import { BACKGROUND_UPLOAD_LIMITS } from "#shared";

const RECOMMENDED_SIZE = `${BACKGROUND_UPLOAD_LIMITS.recommendedWidth}×${BACKGROUND_UPLOAD_LIMITS.recommendedHeight}`;

export const BACKGROUND_COPY = {
  none: "배경 없음",
  blackScreen: "검은 화면",
  selected: "선택됨",
  image: "이미지",
  seconds: (sec: number) => `${sec}초`,
  previewFailed: "미리보기를 불러오지 못했습니다",
  noBackgrounds: "아직 등록된 배경이 없습니다.",
  moodTags: "분위기 태그",
  upload: "배경 올리기",
  picker: {
    title: "곡 배경 선택",
    description:
      "한 곡의 모든 슬라이드가 같은 배경을 씁니다. 영상은 슬라이드가 넘어가도 끊기지 않고 이어집니다.",
    offline: "오프라인: 저장해 둔 배경 목록입니다",
    cachedHint:
      "고른 배경은 편집·송출 중에 이 기기에 저장되어 오프라인에서도 재생됩니다",
  },
  library: {
    offline: "오프라인이라 저장해 둔 목록을 보여 줍니다.",
    title: "모든 배경",
    description:
      "라이선스를 확인해 올린 무음 루프 영상과 이미지입니다. 마우스를 올리면 미리보기가 재생됩니다.",
    count: (count: number) => `${count}개`,
    tags: "태그",
    noTags: "태그 없음",
    noMatch: (query: string) => `“${query}”에 맞는 배경이 없습니다.`,
    noFilterMatch: "조건에 맞는 배경이 없습니다.",
    applyHint:
      "곡에 배경을 입히려면 편집기의 곡 속성 패널에서 ‘배경 변경’을 누르세요.",
    deleteTitle: "배경 삭제",
    deleteMessage: (title: string) =>
      `‘${title}’ — 이 배경을 쓰는 모든 사용자의 곡이 배경 없음이 됩니다. 지운 파일은 되살릴 수 없습니다.`,
    deleting: "지우는 중…",
  },
  uploadDialog: {
    description: (maxSize: string) =>
      `MP4(H.264) 영상이나 JPEG·PNG·WebP 이미지, 파일당 ${maxSize}까지. 올린 배경은 모든 사용자에게 기본 제공 배경으로 보입니다.`,
    changeFile: "다른 파일 고르기",
    probing: "파일을 확인하는 중…",
    dropHint: "여기로 끌어 놓거나 눌러서 파일 고르기",
    recommendation: `권장 해상도 ${RECOMMENDED_SIZE} · 영상 소리는 송출에서 항상 꺼집니다`,
    lowResolution: `${RECOMMENDED_SIZE}보다 작습니다. 올릴 수는 있지만 송출 화면에서 확대되어 흐려 보일 수 있습니다.`,
    titleLabel: "배경 제목",
    titlePlaceholder: "예: 본당 성탄 배경",
    licenseLabel: "출처·라이선스",
    licensePlaceholder: "예: Pexels License — 작가명, 자체 제작 (CC0)",
    tagsLabel: "분위기 태그 (선택)",
    rightsLabel: "모든 사용자에게 배포해도 되는 라이선스를 확인했습니다",
    rightsHint: "확인되지 않은 파일은 올리지 않습니다.",
    submit: "올리기",
    submitting: "올리는 중…",
    cannotOpen: "파일을 열 수 없습니다",
  },
  probe: {
    fileTooLarge: (max: string, actual: string) =>
      `파일 하나는 ${max} 이하만 올릴 수 있습니다 (지금 ${actual})`,
    unplayableVideo:
      "이 브라우저에서 재생할 수 없는 영상입니다. H.264 코덱의 MP4로 바꿔 올려 주세요",
    unreadableImage:
      "이미지를 열 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요",
  },
} as const;
