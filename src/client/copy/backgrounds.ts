import { COMMON_COPY } from "./common";

export const BACKGROUND_COPY = {
  selected: "선택됨",
  video: "영상",
  image: "이미지",
  saved: "기기에 저장됨",
  kindFilter: "배경 종류",
  seconds: (sec: number) => `${sec}초`,
  previewFailed: "미리보기를 불러오지 못했어요",
  noBackgrounds: "아직 배경이 없어요.",
  offline: "오프라인이라 저장해 둔 배경만 보여요",
  picker: {
    title: "곡 배경 선택",
    description:
      "곡의 모든 슬라이드에 같은 배경이 깔려요. 단색이나 영상·이미지 중에서 골라 주세요.",
    solid: "단색",
    media: "영상·이미지",
    cachedHint: "고른 배경은 이 기기에 저장해 두어 오프라인에서도 재생돼요",
    searchLabel: "배경 검색",
    searchPlaceholder:
      "찾는 배경을 말하듯 적어 주세요 (예: 기도할 때 쓸 잔잔한 파란 배경)",
  },
  prepare: {
    title: "배경 영상을 준비하고 있어요",
    description:
      "이 기기에 모두 저장하면 송출을 시작해요. 저장해 두면 인터넷이 끊겨도 배경이 멈추지 않아요.",
    count: (ready: number, total: number) => `${ready}/${total}개`,
    size: (received: string, total: string) => `${received} / ${total}`,
    megabytes: (mb: number) => `${mb}MB`,
    failed: {
      offline:
        "인터넷에 연결되지 않아 배경 영상을 받지 못했어요. 연결한 뒤 다시 시도해 주세요.",
      quota:
        "기기 저장 공간이 부족해 배경 영상을 저장하지 못했어요. 공간을 비운 뒤 다시 시도해 주세요.",
      network:
        "배경 영상을 받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.",
    },
    retry: COMMON_COPY.retry,
    startWithSaved: "저장된 배경으로 시작",
    savedHint: "저장하지 못한 곡은 배경 대신 정지 화면이 보여요.",
    editorStatus: (ready: number, total: number) =>
      `배경 저장 중 ${ready}/${total}`,
    editorRetrying: (ready: number, total: number) =>
      `배경 다시 시도 대기 ${ready}/${total}`,
    editorQuota: "기기 저장 공간 부족",
    editorFailed: "배경 저장 실패",
  },
  library: {
    noMatch: (query: string) => `‘${query}’에 맞는 배경이 없어요.`,
    noFilterMatch: "조건에 맞는 배경이 없어요.",
    searching: "배경을 찾고 있어요.",
    searchFailed:
      "지금은 배경을 검색할 수 없어요. 인터넷 연결을 확인하고 다시 검색해 주세요.",
  },
} as const;
