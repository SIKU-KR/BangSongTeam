import { toDisplayName, toWellFormedText } from "#shared";

const BIDI_CONTROLS = /\p{Bidi_Control}/gu;

/**
 * 사용자 문서에 저장할 이름. 방향 제어 문자를 빼고 `toDisplayName`으로 다듬는다. 다듬은 이름이
 * 비면 거절하지 않고 기본 이름으로 바꿔, 소셜 프로필 이름이 그렇더라도 로그인이 막히지 않는다.
 *
 * 방향 제어 문자(RLO 등)는 보이지 않으면서 글자를 저장한 순서와 다르게 늘어놓아, 공유받은
 * 프레젠테이션의 멤버·원작 표시에서 다른 사람 이름처럼 보이게 만들 수 있다.
 *
 * 짝을 잃은 서로게이트는 U+FFFD로 바꾼다(`toWellFormedText`). Firestore가 그런 이름의 사용자 문서를
 * 저장하지 못해, 가입과 그 이름의 소셜 프로필 로그인이 실패한다.
 */
export function toAccountName(raw: unknown): string {
  return toDisplayName(
    typeof raw === "string"
      ? toWellFormedText(raw.replace(BIDI_CONTROLS, ""))
      : raw,
  );
}
