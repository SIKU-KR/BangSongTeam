/**
 * 공유 링크(`/s/:token`)로 들어오는 화면의 문구. 링크 참여 화면은 첫 로드 청크에
 * 있으므로 공유 다이얼로그 문구(sharing.ts)와 파일을 나눈다.
 */
export const SHARE_LINK_COPY = {
  unavailable: "공유 프레젠테이션을 열 수 없어요",
  opening: "공유받은 프레젠테이션을 여는 중…",
  goToPresentations: "내 프레젠테이션으로",
  signIn: "로그인하기",
  signInToCopy: "로그인하면 사본을 내 드라이브에 만들어 고칠 수 있어요.",
} as const;
