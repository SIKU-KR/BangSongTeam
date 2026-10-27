import {
  FALLBACK_USER_NAME,
  OFFICIAL_LIBRARY_NAME,
  toDisplayName,
} from "#shared";

function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

const RESERVED_NAME_KEYS = [nameKey(OFFICIAL_LIBRARY_NAME)];

/**
 * 다른 사람이 쓸 수 없는 이름인지. 지금은 공식 라이브러리 이름(`OFFICIAL_LIBRARY_NAME`)이다.
 *
 * 공유 라이브러리 카드와 가져온 곡의 원작 표시는 작성자 이름을 그대로 보여 줘, 같은 이름이면
 * 바꾼 가사도 공식 곡처럼 보인다. 그래서 전각·분해된 한글을 NFKC로 맞추고 띄어쓰기·문장 부호·
 * 보이지 않는 문자를 뺀 뒤, 그 이름이 들어 있기만 해도 쓸 수 없는 이름으로 본다.
 */
export function isReservedUserName(name: string): boolean {
  const key = nameKey(name);
  return RESERVED_NAME_KEYS.some((reserved) => key.includes(reserved));
}

/**
 * 사용자 문서에 저장할 이름. `toDisplayName`으로 다듬고, 쓸 수 없는 이름
 * (`isReservedUserName`)은 거절하지 않고 기본 이름으로 바꾼다. 소셜 프로필 이름이 그렇더라도
 * 로그인이 막히지 않는다.
 */
export function toAccountName(raw: unknown): string {
  const name = toDisplayName(raw);
  return isReservedUserName(name) ? FALLBACK_USER_NAME.default : name;
}
