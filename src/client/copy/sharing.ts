import { COMMON_COPY } from "./common";

const PUBLISH = "공유 라이브러리에 공개";

export const SHARING_COPY = {
  library: {
    publish: PUBLISH,
    takenDown: "게시 중단됨 — 운영자가 공개를 내렸습니다",
    public: (forks: number) =>
      `${PUBLISH} 중 · ${COMMON_COPY.forkCount(forks)}`,
    private: "비공개 — 나만 볼 수 있습니다",
    suggestCorrection: "원본에 교정 제안",
    unpublish: "비공개로 전환",
    unpublishing: "전환 중…",
    onlineOnly: "공유는 온라인에서만 할 수 있습니다.",
    deckNotFound: "보관함에서 곡을 찾을 수 없습니다",
  },
  publishDialog: {
    notes: [
      "공개하면 다른 사용자가 이 곡의 가사·슬라이드 나눔·배경·스타일을 검색해 자기 보관함으로 가져갈 수 있습니다. 로그인하지 않은 사람에게는 첫 슬라이드만 보입니다.",
      "가사의 저작권은 원저작자에게 있습니다. 각 교회의 저작권 라이선스(예: CCLI) 범위 안에서 사용해야 하며, 권리자가 요청하면 운영자가 공개를 중단할 수 있습니다.",
      "언제든 비공개로 돌릴 수 있습니다. 다만 이미 가져간 사람의 사본은 남습니다.",
      "내 보관함에 있는 이 곡 그대로 공개됩니다. 세트에서 고친 가사나 서식은 들어가지 않습니다.",
    ],
    accept: "위 내용을 확인했습니다",
    confirm: "공개하기",
    pending: "공개하는 중…",
  },
  report: {
    title: "신고하기",
    done: "신고가 접수되었습니다. 운영자가 확인한 뒤 처리합니다.",
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
        hint: "권리자이거나 권리자를 대리해 게시 중단을 요청합니다",
      },
    },
  },
  link: {
    access: "일반 액세스",
    accessOptions: {
      off: "제한됨 (나만 접근)",
      view: "링크가 있는 사람은 보기 가능",
    },
    accessHints: {
      off: "링크를 열어도 들어올 수 없습니다.",
      view: "로그인한 사람은 보고 발표할 수 있고, 사본을 만들어 자기 세트로 고칠 수 있습니다.",
    },
    link: "링크",
    shareLink: "공유 링크",
    copied: "링크를 복사했습니다",
    copyFailed: "링크를 복사하지 못했습니다",
    reset: "링크 재설정",
    done: "완료",
    resetTitle: "링크를 재설정할까요?",
    resetDescription:
      "지금 링크는 더 이상 열리지 않고, 이 링크로 들어온 사람은 모두 접근을 잃습니다. 새 링크를 다시 보내야 합니다.",
    resetConfirm: "재설정",
    regenerated: "새 링크를 만들었습니다",
    unavailable: "공유 세트를 열 수 없습니다",
    opening: "공유받은 세트를 여는 중…",
    goToPresentations: "내 프레젠테이션으로",
    signIn: "로그인하기",
    signInToCopy:
      "로그인하면 이 세트의 사본을 내 드라이브에 만들어 고칠 수 있습니다.",
    revoked: "공유가 해제되어 더 이상 볼 수 없습니다",
  },
} as const;
