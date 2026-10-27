export const PRESENTATION_COPY = {
  exit: "송출 종료",
  sharedRevoked: "공유가 해제되어 더 이상 볼 수 없어요",
  conflictSavedAsCopy: (title: string) =>
    `다른 기기나 창에서 먼저 바꾼 내용이 있어요. 이 기기에서 고친 내용은 '${title}'에 따로 저장했어요`,
  deletedElsewhere:
    "다른 기기나 창에서 영구 삭제한 프레젠테이션이라 여기서도 지웠어요",
  deletedSavedAsCopy: (title: string) =>
    `다른 기기나 창에서 영구 삭제한 프레젠테이션이에요. 이 기기에서 고친 내용은 '${title}'에 따로 저장했어요`,
} as const;
