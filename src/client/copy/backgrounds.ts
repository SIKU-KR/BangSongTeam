import { BACKGROUND_UPLOAD_LIMITS } from "#shared";

const RECOMMENDED_SIZE = `${BACKGROUND_UPLOAD_LIMITS.recommendedWidth}×${BACKGROUND_UPLOAD_LIMITS.recommendedHeight}`;

export const BACKGROUND_COPY = {
  selected: "선택됨",
  video: "영상",
  image: "이미지",
  kindFilter: "배경 종류",
  seconds: (sec: number) => `${sec}초`,
  previewFailed: "미리보기를 불러오지 못했어요",
  noBackgrounds: "아직 배경이 없어요.",
  upload: "배경 올리기",
  offline: "오프라인이라 저장해 둔 배경만 보여요",
  picker: {
    title: "곡 배경 선택",
    description:
      "곡의 모든 슬라이드에 같은 배경이 깔려요. 단색이나 영상·이미지 중에서 골라 주세요.",
    solid: "단색",
    media: "영상·이미지",
    cachedHint: "고른 배경은 이 기기에 저장해 두어 오프라인에서도 재생돼요",
  },
  library: {
    title: "모든 배경",
    description:
      "라이선스를 확인하고 올린 무음 루프 영상과 이미지예요.",
    count: (count: number) => `${count}개`,
    noMatch: (query: string) => `‘${query}’에 맞는 배경이 없어요.`,
    noFilterMatch: "조건에 맞는 배경이 없어요.",
    applyHint: "편집기 위쪽의 ‘배경’ 버튼을 눌러 곡에 입혀 보세요.",
    deleteTitle: "배경 삭제",
    deleteMessage: (title: string) =>
      `‘${title}’ 배경을 삭제할까요? 이 배경을 쓰던 곡은 모두 배경 없음이 되고, 삭제하면 되돌릴 수 없어요.`,
    deleting: "삭제하는 중…",
  },
  uploadDialog: {
    description: (maxSize: string) =>
      `MP4(H.264) 영상이나 JPEG·PNG·WebP 이미지를 ${maxSize}까지 올릴 수 있어요. 올린 배경은 모든 사용자가 쓸 수 있어요.`,
    changeFile: "다른 파일 고르기",
    probing: "파일을 확인하는 중…",
    dropHint: "여기로 끌어 놓거나 눌러서 파일 고르기",
    recommendation: `권장 해상도 ${RECOMMENDED_SIZE} · 영상 소리는 송출할 때 꺼져요`,
    lowResolution: `${RECOMMENDED_SIZE}보다 작아요. 송출 화면에서 흐려 보일 수 있어요.`,
    titleLabel: "배경 제목",
    titlePlaceholder: "예: 본당 성탄 배경",
    licenseLabel: "출처·라이선스",
    licensePlaceholder: "예: Pexels License — 작가명, 자체 제작 (CC0)",
    rightsLabel: "모든 사용자에게 배포해도 되는 라이선스를 확인했어요",
    rightsHint: "확인한 파일만 올려 주세요.",
    submit: "올리기",
    submitting: "올리는 중…",
    cannotOpen: "파일을 열 수 없어요",
  },
  probe: {
    fileTooLarge: (max: string, actual: string) =>
      `파일은 하나에 ${max}까지 올릴 수 있어요 (지금 ${actual})`,
    unplayableVideo:
      "이 브라우저에서 재생할 수 없는 영상이에요. H.264 코덱의 MP4로 바꿔 올려 주세요",
    unreadableImage:
      "이미지를 열 수 없어요. 파일이 손상되지 않았는지 확인해 주세요",
  },
} as const;
