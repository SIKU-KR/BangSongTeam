import type { Context, TypedResponse } from "hono";
import {
  MAX_PRESENTATION_SONGS,
  MAX_WRITE_LYRICS_LENGTH,
  MAX_WRITE_SLIDES,
  fitDeckText,
} from "#shared";

/**
 * 쓰기 한도를 넘은 곳. `song`은 가사 길이나 슬라이드 수가 한도를 넘은 곡이고(`title`은 한도에
 * 맞춰 다듬은 그 곡의 제목), `songCount`는 프레젠테이션의 곡 수다.
 */
export type WriteLimitBreach =
  { kind: "song"; title: string } | { kind: "songCount" };

type OverLimitResponse = Response &
  TypedResponse<{ error: string }, 413, "json">;

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function codePointLength(text: string): number {
  let count = text.length;
  for (let i = 0; i < text.length - 1; i += 1) {
    if (
      (text.charCodeAt(i) & 0xfc00) === 0xd800 &&
      (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00
    ) {
      count -= 1;
      i += 1;
    }
  }
  return count;
}

function isSongOverLimit(song: unknown): boolean {
  const lyricsRaw = fieldOf(song, "lyricsRaw");
  const slides = fieldOf(song, "slides");
  return (
    (typeof lyricsRaw === "string" &&
      lyricsRaw.length > MAX_WRITE_LYRICS_LENGTH &&
      codePointLength(lyricsRaw) > MAX_WRITE_LYRICS_LENGTH) ||
    (Array.isArray(slides) && slides.length > MAX_WRITE_SLIDES)
  );
}

function findWriteLimitBreach(body: unknown): WriteLimitBreach | null {
  const items = fieldOf(body, "items");
  const decks = fieldOf(body, "decks");
  if (
    (Array.isArray(items) && items.length > MAX_PRESENTATION_SONGS) ||
    (Array.isArray(decks) && decks.length > MAX_PRESENTATION_SONGS)
  ) {
    return { kind: "songCount" };
  }
  const songs = [
    body,
    ...(Array.isArray(decks) ? decks : []),
    ...(Array.isArray(items) ? items.map((item) => fieldOf(item, "deck")) : []),
  ];
  const song = songs.find(isSongOverLimit);
  if (song === undefined) return null;
  return {
    kind: "song",
    title: fitDeckText({ title: fieldOf(song, "title"), artist: null }).title,
  };
}

/**
 * 저장 본문 `jsonBody`의 `onInvalid`. 검사에 실패한 본문이 쓰기 한도(`DeckWriteSchema`의 가사
 * 길이·슬라이드 수, `MAX_PRESENTATION_SONGS`)를 넘었으면 413과 `message`가 만든 문장으로 답하고,
 * 그 밖의 검사 실패는 `jsonBody` 기본대로 400으로 둔다.
 *
 * 한도를 넘은 본문은 고치지 않는 한 몇 번을 다시 보내도 거절되고, 클라이언트는 이전 버전까지
 * 4xx를 영구 실패로 남기고 다시 보내지 않는다. 그래서 무엇을 줄일지 말하는 문장을 담은 413으로
 * 나눈다. 슬라이드 id 길이처럼 앱이 만들지 않는 값은 잘못된 본문(400)으로 둔다.
 *
 * `jsonBody`는 첫 문제에서 검사를 멈춰 문제 목록이 없으므로, 받은 본문에서 곡(본문 자체,
 * `decks`의 곡, `items`의 `deck`)과 곡 목록의 길이를 직접 본다. 곡 수가 한도 안일 때만 곡을
 * 훑으므로 큰 본문에서도 곡 200개 남짓만 본다. 가사 길이는 스키마(Zod `.max()`)처럼 코드
 * 포인트로 센다(짝이 맞는 서로게이트 쌍은 한 글자). UTF-16 길이로 세면 이모지가 많은 가사가 든
 * 틀린 본문을 400 대신 413으로 답한다.
 */
export function rejectOverLimit(
  message: (breach: WriteLimitBreach) => string,
): (body: unknown, c: Context) => OverLimitResponse | undefined {
  return (body, c) => {
    const breach = findWriteLimitBreach(body);
    return breach ? c.json({ error: message(breach) }, 413) : undefined;
  };
}
