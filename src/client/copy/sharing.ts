export const SHARING_COPY = {
  link: {
    access: "링크 공유",
    accessOptions: {
      off: "나만 보기",
      view: "링크가 있으면 누구나 보기",
    },
    accessHints: {
      off: "링크로는 들어올 수 없어요.",
      view: "로그인하지 않아도 누구나 보고 발표할 수 있어요. 로그인하면 사본을 만들어 고칠 수 있어요.",
    },
    link: "링크",
    shareLink: "공유 링크",
    copied: "링크를 복사했어요",
    copyFailed: "링크를 복사하지 못했어요",
    reset: "링크 재설정",
    done: "완료",
    resetTitle: "링크를 재설정할까요?",
    resetDescription:
      "지금 링크로 들어온 사람은 더 이상 볼 수 없어요. 새 링크를 다시 보내 주세요.",
    resetConfirm: "재설정",
    regenerated: "새 링크를 만들었어요",
    onlineOnly: "공유는 온라인에서만 할 수 있어요.",
    notSynced:
      "아직 서버와 동기화하지 않았어요. 동기화가 끝나면 다시 열어 주세요",
  },
} as const;
