import { COMMON_COPY } from "./common";

const PUBLISH = "공유 라이브러리에 공개";

export const SHARING_COPY = {
  library: {
    publish: PUBLISH,
    takenDown: "운영자가 공개를 중단했어요",
    public: (forks: number) =>
      `${PUBLISH} 중 · ${COMMON_COPY.forkCount(forks)}`,
    private: "비공개 · 나만 볼 수 있어요",
    suggestCorrection: "원본에 교정 제안",
    unpublish: "비공개로 전환",
    unpublishing: "전환 중…",
    onlineOnly: "공유는 온라인에서만 할 수 있어요.",
    deckNotFound: "보관함에서 곡을 찾을 수 없어요",
  },
  publishDialog: {
    notes: [
      "다른 사람이 이 곡의 가사, 슬라이드 나눔, 배경, 서식을 검색해 자기 보관함으로 가져갈 수 있어요. 로그인하지 않은 사람에겐 첫 슬라이드만 보여요.",
      "가사 저작권은 원저작자에게 있어요. 교회의 저작권 라이선스(예: CCLI) 범위에서 써 주세요. 권리자가 요청하면 운영자가 공개를 중단할 수 있어요.",
      "언제든 비공개로 돌릴 수 있어요. 이미 가져간 사본은 남아요.",
      "보관함에 있는 곡 그대로 공개돼요. 프레젠테이션에서 고친 가사나 서식은 들어가지 않아요.",
    ],
    accept: "위 내용을 확인했어요",
    confirm: "공개하기",
    pending: "공개하는 중…",
  },
  report: {
    title: "신고하기",
    done: "신고를 받았어요. 운영자가 확인한 뒤 처리할게요.",
    reason: "신고 사유",
    details: "자세한 내용 (선택)",
    detailsPlaceholder: "500자 이내",
    submit: "신고 보내기",
    pending: "보내는 중…",
    reasons: {
      lyrics_error: {
        label: "가사 오류",
        hint: "틀린 가사, 빠진 절, 순서가 뒤바뀐 곳",
      },
      correction: {
        label: "교정 제안",
        hint: "이렇게 고치면 좋겠다는 제안 (아래에 고친 가사를 적어 주세요)",
      },
      inappropriate: {
        label: "부적절한 콘텐츠",
        hint: "찬양과 무관하거나 불쾌한 내용",
      },
      copyright: {
        label: "저작권 게시 중단 요청",
        hint: "권리자이거나 권리자를 대리해 게시 중단을 요청해요",
      },
    },
  },
  link: {
    access: "링크 공유",
    accessOptions: {
      off: "나만 보기",
      view: "링크가 있으면 누구나 보기",
    },
    accessHints: {
      off: "링크로는 들어올 수 없어요.",
      view: "로그인한 사람은 보고 발표할 수 있어요. 사본을 만들면 고칠 수도 있어요.",
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
  },
} as const;
