/**
 * 운영 스크립트(`scripts/*.mjs`)가 `src/db/ops`를 거쳐 터미널에 보여 주는 오류 문장.
 * 사용자 화면에는 나오지 않고, 운영자가 다음에 무엇을 할지 알 수 있게 쓴다.
 */
export const OPS_ERRORS = {
  importTargetNotEmpty:
    "대상 Firestore에 이미 사용자가 있어요. 이전을 마친 뒤에 다시 돌리면 그 뒤에 생긴 데이터와 게시 중단을 D1의 옛 값으로 덮어써요. 롤백한 뒤 다시 옮기거나 멈춘 이전을 이어 갈 때만 --overwrite-existing(Cloud Build는 _OVERWRITE_EXISTING=true)을 붙여 주세요",
  report: {
    notFound: "신고를 찾을 수 없어요",
    alreadyResolved:
      "이미 처리 완료로 닫은 신고예요. 바로잡으려면 --force를 붙여 주세요",
    alreadyRejected: "이미 기각한 신고예요. 바로잡으려면 --force를 붙여 주세요",
  },
  restore: {
    sourceTakenDown:
      "원곡이 아직 게시 중단돼 있어 다시 공개할 수 없어요. 원곡의 게시 중단을 먼저 풀어 주세요",
  },
} as const;
