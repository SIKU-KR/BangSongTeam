import { withDirectionParticle, withObjectParticle } from "#shared";
import { COMMON_COPY } from "./common";

export const DRIVE_COPY = {
  kind: { folder: "폴더", file: "프레젠테이션" },
  newFolder: "새 폴더",
  newItem: "새로 만들기",
  create: "만들기",
  open: "열기",
  openInEditor: "편집기에서 열기",
  present: "발표",
  presentFullscreen: "발표 (전체화면 송출)",
  rename: "이름 바꾸기",
  move: "이동",
  moveToTrash: "휴지통으로 이동",
  restore: "복원",
  deleteForever: "영구 삭제",
  emptyTrash: "휴지통 비우기",
  deleting: "삭제하는 중…",
  name: "이름",
  location: "위치",
  originalLocation: "원래 위치",
  deletedAt: "삭제일",
  updatedAt: "수정일",
  actions: "작업",
  moreActions: "작업 더보기",
  more: (name: string) => `${name} 더보기`,
  expand: (name: string) => `${name} 펼치기`,
  collapse: (name: string) => `${name} 접기`,
  breadcrumbs: "드라이브 경로",
  currentFolder: "현재 폴더",
  currentFolderMenu: "현재 폴더 메뉴",
  itemsList: "폴더와 프레젠테이션",
  trashFolder: `${COMMON_COPY.trash} (고정 폴더)`,
  openTrash: `${COMMON_COPY.trash} 열기`,
  trashMore: `${COMMON_COPY.trash} 더보기`,
  trashSummary:
    "휴지통의 항목은 영구 삭제하기 전까지 언제든 복원할 수 있습니다.",
  openTrashedItem: "휴지통에 있는 항목은 복원한 뒤 열 수 있습니다",
  type: "유형",
  clearType: "유형 필터 지우기",
  clearSelection: "선택 해제",
  selected: (count: number) => `${count}개 선택됨`,
  itemCount: (count: number) => `${count}개 항목`,
  quoted: (name: string) => `‘${name}’`,
  summary: {
    search: (query: string, count: number) => `‘${query}’ 검색 결과 ${count}개`,
    counts: (folders: number, files: number) =>
      `폴더 ${folders}개 · 프레젠테이션 ${files}개`,
  },
  empty: {
    searchTitle: (query: string) => `"${query}"에 일치하는 항목이 없습니다.`,
    searchHint:
      "다른 검색어를 입력해 보세요. 폴더 이름, 세트 제목, 곡 제목·가사로 찾을 수 있습니다.",
    filteredTitle: "선택한 유형의 항목이 없습니다",
    filteredHint: "유형 필터를 지우면 모든 항목을 볼 수 있습니다.",
    trashTitle: "휴지통이 비어 있습니다",
    trashHint: "삭제한 폴더와 프레젠테이션이 여기에 모입니다.",
    folderTitle: "이 폴더가 비어 있습니다",
    folderHint:
      "새 폴더나 프레젠테이션을 만들거나, 다른 항목을 이 폴더로 끌어다 놓으세요.",
    rootTitle: "아직 프레젠테이션이 없습니다",
    rootHint:
      "새 프레젠테이션을 만들어 예배 세트를 준비해 보세요. 폴더로 정리할 수도 있습니다.",
  },
  toast: {
    trashed: (label: string) =>
      `${withObjectParticle(label)} 휴지통으로 이동했습니다`,
    restored: (label: string) => `${withObjectParticle(label)} 복원했습니다`,
    moved: (label: string, target: string) =>
      `${withObjectParticle(label)} ${withDirectionParticle(`‘${target}’`)} 옮겼습니다`,
    duplicated: (title: string) =>
      `${withObjectParticle(`‘${title}’`)} 만들었습니다`,
    duplicatedMany: (count: number) => `사본 ${count}개를 만들었습니다`,
    deletedForever: (label: string) =>
      `${withObjectParticle(label)} 영구 삭제했습니다`,
    deletedForeverMany: (count: number) =>
      `${count}개 항목을 영구 삭제했습니다`,
    deleteForeverFailed: "영구 삭제하지 못했습니다",
  },
  moveDialog: {
    title: (name: string) => `‘${name}’ 이동`,
    titleMany: (count: number) => `${count}개 항목 이동`,
    currentLocation: (location: string) => `현재 위치: ${location}`,
    target: "옮길 위치",
  },
  deleteForeverDialog: {
    message: (label: string) => `${withObjectParticle(label)} 영구 삭제합니다.`,
    folderNote: " 폴더 안의 모든 항목도 함께 삭제됩니다.",
    irreversible: "이 작업은 되돌릴 수 없습니다.",
  },
  emptyTrashMessage:
    "휴지통의 모든 항목이 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다.",
  nameRequired: "이름을 입력하세요",
  nameTooLong: (max: number) => `이름은 ${max}자까지 쓸 수 있습니다`,
  nameTaken: "같은 위치에 같은 이름의 폴더가 있습니다",
  folderNotFound: "폴더를 찾을 수 없습니다",
  targetFolderNotFound: "옮길 폴더를 찾을 수 없습니다",
  cannotMoveIntoSelf: "폴더를 자기 안으로 옮길 수 없습니다",
  presentUnreliable:
    "이 브라우저에서는 전체화면 송출이나 배경 영상이 제대로 동작하지 않을 수 있습니다.\n\n계속 진행하시겠습니까?",
  deleteForeverOffline:
    "오프라인 상태에서는 영구 삭제할 수 없습니다. 인터넷에 연결한 뒤 다시 시도하세요.",
  deleteForeverRetry: "영구 삭제하지 못했습니다. 잠시 후 다시 시도하세요.",
} as const;
