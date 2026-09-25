/**
 * 로그인하지 않은 사람이 '사본 만들기'를 누르면 링크 주소에 붙인다.
 * 소셜 로그인은 지금 주소로 돌아오므로, 로그인 뒤에도 이 표시가 남아
 * 사본 만들기 창을 이어서 연다.
 */
export const SHARE_COPY_PARAM = "copy";

export function shareCopyPath(token: string): string {
  return `/s/${token}?${SHARE_COPY_PARAM}=1`;
}

/** 편집기를 열자마자 사본 만들기 창을 띄우라는 history state */
export const MAKE_COPY_STATE = { makeCopy: true } as const;

export function wantsMakeCopy(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as { makeCopy?: unknown }).makeCopy === true
  );
}
