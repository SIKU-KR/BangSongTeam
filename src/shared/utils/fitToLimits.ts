import { FALLBACK_USER_NAME, UNTITLED_SONG } from "../copy/app";
import { USER_NAME_MAX_LENGTH } from "../schemas/api";
import {
  MAX_DECK_ARTIST_LENGTH,
  MAX_DECK_TITLE_LENGTH,
  MAX_FORKED_FROM_AUTHOR_NAME_LENGTH,
} from "../schemas/deck";

/**
 * 글을 `max` UTF-16 코드 단위 안으로 자른다. 한도 안이면 그대로 돌려준다.
 *
 * HTML `maxLength`와 같은 단위로 세고, 코드 포인트로 세는 Zod `.max()`도 언제나 통과한다.
 * 이모지 같은 서로게이트 쌍을 반쪽으로 남기지 않는다. 반쪽만 남은 문자열은
 * `encodeURIComponent`가 예외를 던진다.
 */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const last = sliced.charCodeAt(sliced.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

const BIDI_EXPLICIT_FORMATTING = /[\u202A-\u202E\u2066-\u2069]/g;

const VISIBLE_CHARACTER =
  /[^\p{White_Space}\p{Cc}\p{Default_Ignorable_Code_Point}\u2800]/u;

/**
 * 사용자 문서의 `name`을 화면에 보일 이름으로 다듬는다. 양방향 제어 문자와 앞뒤 공백을 떼고
 * `USER_NAME_MAX_LENGTH`자로 줄이며, 문자열이 아니거나 보이는 글자가 남지 않으면 기본 이름을
 * 쓴다.
 *
 * 이 이름은 다른 사용자에게 가는 응답(공유 라이브러리 카드, 가져온 곡의 원작 표시, 공유받은
 * 프레젠테이션의 소유자)에 그대로 실린다. Better Auth의 옛 계정이나 이름 검사가 없던 경로로
 * 저장된 이름이 숫자·객체·긴 문자열이어도, 받는 쪽의 엄격한 스키마가 응답 전체를 버리지 않게
 * 한다. 던지지 않는다.
 *
 * - 한글 채움 문자(U+3164)나 폭 없는 공백처럼 `trim()`이 떼지 않는 글자만 남은 이름은 받는
 *   쪽에서 빈칸으로 보이므로 이름이 없는 것으로 본다. 카카오에서 빈 닉네임을 만드는 흔한
 *   방법이다.
 * - embedding·override·isolate 제어 문자(U+202A–U+202E, U+2066–U+2069)는 이름 뒤에 이어지는
 *   글의 순서까지 뒤집으므로 뺀다. ZWJ·변형 선택자는 이모지 조합에 쓰여 이름 안에 그대로 둔다.
 */
export function toDisplayName(raw: unknown): string {
  if (typeof raw !== "string") return FALLBACK_USER_NAME.default;
  const name = clampText(
    raw.replace(BIDI_EXPLICIT_FORMATTING, "").trim(),
    USER_NAME_MAX_LENGTH,
  );
  return VISIBLE_CHARACTER.test(name) ? name : FALLBACK_USER_NAME.default;
}

/** 곡 DTO의 글 필드. 원작자 이름은 키를 빼지 않고 없으면 `null`로 둔다 */
export interface DeckText {
  title: string;
  artist: string;
  forkedFromAuthorName: string | null;
}

/**
 * 저장된 곡의 제목·아티스트·원작자 이름을 `DeckSchema` 한도에 맞춘다. 던지지 않고 세 키를
 * 언제나 채운다.
 *
 * 시드·D1에서 옮긴 데이터에는 100자를 넘는 메들리 제목이 있고, 원작자 이름은 검사 없이 저장된
 * 사용자 이름을 베낀 값이다. 그대로 내보내면 이전 클라이언트까지 포함한 받는 쪽의 엄격한
 * 스키마가 가져오기 응답·프레젠테이션 문서 전체를 거절한다. 비거나 문자열이 아닌 제목은
 * '(제목 없음)', 문자열이 아닌 아티스트는 빈 문자열, 문자열이 아닌 원작자 이름은 기본 이름이다.
 */
export function fitDeckText(deck: {
  title: unknown;
  artist: unknown;
  forkedFromAuthorName?: unknown;
}): DeckText {
  const { title, artist, forkedFromAuthorName: author } = deck;
  return {
    title:
      typeof title === "string" && title.length > 0
        ? clampText(title, MAX_DECK_TITLE_LENGTH)
        : UNTITLED_SONG,
    artist:
      typeof artist === "string"
        ? clampText(artist, MAX_DECK_ARTIST_LENGTH)
        : "",
    forkedFromAuthorName:
      author === null || author === undefined
        ? null
        : typeof author === "string"
          ? clampText(author, MAX_FORKED_FROM_AUTHOR_NAME_LENGTH)
          : FALLBACK_USER_NAME.default,
  };
}

/**
 * 0 이상의 안전한 정수만 그대로 두고 나머지(음수·소수·NaN·없는 값)는 0으로 읽는다.
 *
 * 가져간 횟수(`forkCount`)는 곡을 지울 때 원본 횟수를 1 줄이는데(`deleteDeckScoped`), 옮겨 온
 * 데이터처럼 처음 값이 맞지 않던 곡은 0 아래로 내려갈 수 있다. 받는 쪽 스키마는
 * `nonnegative()` 정수만 받는다.
 */
export function toNonNegativeInt(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : 0;
}
