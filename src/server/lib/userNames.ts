import {
  FALLBACK_USER_NAME,
  OFFICIAL_LIBRARY_NAME,
  toDisplayName,
  toWellFormedText,
} from "#shared";

const IGNORED_IN_NAME_KEY = /\p{Default_Ignorable_Code_Point}|[^\p{L}\p{N}]/gu;

const BIDI_CONTROLS = /\p{Bidi_Control}/gu;

function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(IGNORED_IN_NAME_KEY, "")
    .normalize("NFKC")
    .toLowerCase();
}

const RESERVED_NAME_KEYS = [nameKey(OFFICIAL_LIBRARY_NAME)];

/**
 * 다른 사람이 쓸 수 없는 이름인지. 지금은 공식 라이브러리 이름(`OFFICIAL_LIBRARY_NAME`)이다.
 *
 * 공유 라이브러리 카드와 가져온 곡의 원작 표시는 작성자 이름을 그대로 보여 줘, 같은 이름이면
 * 바꾼 가사도 공식 곡처럼 보인다. 그래서 전각·분해된 한글을 NFKC로 맞추고 띄어쓰기·문장 부호·
 * 보이지 않는 문자를 뺀 뒤, 그 이름이 들어 있기만 해도 쓸 수 없는 이름으로 본다. 한글 채움
 * 문자(U+3164 등)는 글자로 분류되지만 화면에 보이지 않아 함께 뺀다. 뺀 문자가 자모 사이에
 * 있었으면 NFKC로 다시 한 글자로 합친다.
 */
export function isReservedUserName(name: string): boolean {
  const key = nameKey(name);
  return RESERVED_NAME_KEYS.some((reserved) => key.includes(reserved));
}

/**
 * 사용자 문서에 저장할 이름. 방향 제어 문자를 빼고 `toDisplayName`으로 다듬은 뒤, 쓸 수 없는
 * 이름(`isReservedUserName`)은 거절하지 않고 기본 이름으로 바꾼다. 소셜 프로필 이름이 그렇더라도
 * 로그인이 막히지 않는다.
 *
 * 방향 제어 문자(RLO 등)는 보이지 않으면서 글자를 저장한 순서와 다르게 늘어놓는다. 그대로 두면
 * 거꾸로 적은 이름이 화면에서는 공식 라이브러리 이름으로 보여 저장한 순서로 하는 검사를 피한다.
 *
 * 짝을 잃은 서로게이트는 U+FFFD로 바꾼다(`toWellFormedText`). Firestore가 그런 이름의 사용자 문서를
 * 저장하지 못해, 가입과 그 이름의 소셜 프로필 로그인이 실패한다.
 */
export function toAccountName(raw: unknown): string {
  const name = toDisplayName(
    typeof raw === "string"
      ? toWellFormedText(raw.replace(BIDI_CONTROLS, ""))
      : raw,
  );
  return isReservedUserName(name) ? FALLBACK_USER_NAME.default : name;
}
