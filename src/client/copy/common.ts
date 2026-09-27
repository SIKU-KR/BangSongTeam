/** 두 기능 이상에서 같은 뜻으로 쓰는 문구. 기능별 copy는 이 값을 다시 적지 않고 참조한다. */
export const COMMON_COPY = {
  cancel: "취소",
  close: "닫기",
  confirm: "확인",
  save: "저장",
  delete: "삭제",
  copy: "복사",
  undo: "실행 취소",
  redo: "다시 실행",
  makeCopy: "사본 만들기",
  copySuffix: " (사본)",
  share: "공유",
  all: "전체",
  search: "검색",
  clearSearch: "검색어 지우기",
  newPresentation: "새 프레젠테이션",
  myDrive: "내 드라이브",
  trash: "휴지통",
  forkCount: (count: number) => `${count}회 가져감`,
  fontSample: "가나다라마바사 123 ABC",
} as const;

export const ERROR_COPY = {
  offline: "오프라인이라 서버에 연결할 수 없습니다",
  sessionExpired: "로그인이 만료되었습니다. 다시 로그인해 주세요",
  requestFailed: "요청을 처리하지 못했습니다",
  serverUnreachable: "서버에 연결할 수 없습니다",
  sessionExpiredShort: "세션이 만료되었습니다",
  serverRejected: (status: number) => `서버가 요청을 거절했습니다 (${status})`,
  indexedDbUnavailable: "이 브라우저에서 IndexedDB를 사용할 수 없습니다",
  persistence: {
    unavailable:
      "이 브라우저에 저장할 수 없습니다 (시크릿 모드이거나 저장소가 차단되었습니다). 새로고침하면 작업이 사라집니다.",
    quota:
      "저장 공간이 가득 찼습니다. 오래된 프레젠테이션을 정리하지 않으면 작업이 저장되지 않습니다.",
    unknown: "이 브라우저에 저장하지 못했습니다. 작업이 사라질 수 있습니다.",
  },
} as const;
