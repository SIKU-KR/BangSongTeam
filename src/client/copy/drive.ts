import { withDirectionParticle, withObjectParticle } from "#shared";
import { COMMON_COPY } from "./common";

export const DRIVE_COPY = {
  kind: { folder: "폴더", file: "프레젠테이션" },
  newItem: "새로 만들기",
  create: "만들기",
  open: "열기",
  openInEditor: "편집기에서 열기",
  present: "발표",
  presentFullscreen: "전체화면으로 발표",
  rename: "이름 바꾸기",
  move: "옮기기",
  moveToTrash: "휴지통으로 옮기기",
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
  trashSummary: "영구 삭제하기 전까지 언제든 복원할 수 있어요.",
  openTrashedItem: "휴지통에 있는 항목은 복원한 뒤 열 수 있어요",
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
    searchTitle: (query: string) => `‘${query}’에 맞는 항목이 없어요`,
    searchHint: "폴더 이름, 프레젠테이션 제목, 곡 제목, 가사로 찾아보세요.",
    filteredTitle: "선택한 유형의 항목이 없어요",
    filteredHint: "유형 필터를 지우면 모든 항목이 보여요.",
    trashTitle: "휴지통이 비어 있어요",
    trashHint: "삭제한 폴더와 프레젠테이션이 여기에 모여요.",
    folderTitle: "폴더가 비어 있어요",
    folderHint: "새 프레젠테이션을 만들거나 다른 항목을 끌어다 놓아 보세요.",
    rootTitle: "아직 프레젠테이션이 없어요",
    rootHint: "새 프레젠테이션을 만들어 예배를 준비해 보세요.",
  },
  toast: {
    trashed: (label: string) =>
      `${withObjectParticle(label)} 휴지통으로 옮겼어요`,
    restored: (label: string) => `${withObjectParticle(label)} 복원했어요`,
    moved: (label: string, target: string) =>
      `${withObjectParticle(label)} ${withDirectionParticle(`‘${target}’`)} 옮겼어요`,
    duplicated: (title: string) =>
      `${withObjectParticle(`‘${title}’`)} 만들었어요`,
    duplicatedMany: (count: number) => `사본 ${count}개를 만들었어요`,
    deletedForever: (label: string) =>
      `${withObjectParticle(label)} 영구 삭제했어요`,
    deletedForeverMany: (count: number) => `${count}개 항목을 영구 삭제했어요`,
    deleteForeverFailed: "영구 삭제하지 못했어요",
  },
  moveDialog: {
    title: (name: string) => `‘${name}’ 옮기기`,
    titleMany: (count: number) => `${count}개 항목 옮기기`,
    currentLocation: (location: string) => `현재 위치: ${location}`,
    target: "옮길 위치",
  },
  deleteForeverDialog: {
    message: (label: string) => `${withObjectParticle(label)} 영구 삭제할까요?`,
    folderNote: " 폴더 안의 항목도 모두 삭제돼요.",
    irreversible: "삭제하면 되돌릴 수 없어요.",
  },
  emptyTrashMessage:
    "휴지통의 모든 항목을 영구 삭제할까요? 삭제하면 되돌릴 수 없어요.",
  presentUnreliable:
    "이 브라우저에선 전체화면이나 배경 영상이 안 될 수 있어요. 그래도 발표할까요?",
  deleteForeverOffline:
    "오프라인에선 영구 삭제할 수 없어요. 인터넷에 연결한 뒤 다시 시도해 주세요.",
  deleteForeverRetry: "영구 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.",
} as const;
