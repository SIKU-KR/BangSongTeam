import { z } from "zod";
import {
  clampText,
  MAX_DECK_ARTIST_LENGTH,
  MAX_DECK_TITLE_LENGTH,
  OFFICIAL_LIBRARY_USER_ID,
  OPS_ERRORS,
} from "#shared";
import type { Db } from "../client";
import { decksCol, type DeckDoc } from "../collections";
import { withDeckIndex } from "../deckIndex";

/**
 * 공식 라이브러리 곡 하나를 고칠 내용. 운영에 넣은 그대로의 `title`·`artist`로 곡을 찾고,
 * `nextTitle`로 제목을, `lyrics`로 가사 일부를 바꾼다. 둘 중 하나는 있어야 한다.
 * 목록은 `data/officialLibraryFixes.json`에 둔다.
 */
export const LibraryTextFixSchema = z
  .object({
    title: z.string().min(1),
    artist: z.string(),
    nextTitle: z.string().min(1).optional(),
    lyrics: z.object({ from: z.string().min(1), to: z.string() }).optional(),
  })
  .strict()
  .refine((fix) => fix.nextTitle !== undefined || fix.lyrics !== undefined);

export type LibraryTextFix = z.infer<typeof LibraryTextFixSchema>;

/** 고칠 목록 파일을 읽는다. 형식이 맞지 않으면 아무것도 쓰기 전에 던진다 */
export function parseLibraryTextFixes(raw: unknown): LibraryTextFix[] {
  const parsed = z.array(LibraryTextFixSchema).safeParse(raw);
  if (!parsed.success) throw new Error(OPS_ERRORS.libraryFix.invalidFile);
  return parsed.data;
}

/** 고친(미리보기면 고칠) 공식 곡 하나 */
export interface LibraryTextChange {
  id: string;
  title: string;
  nextTitle: string;
  /** 가사도 바꾸는지 */
  lyrics: boolean;
}

export interface LibraryTextFixResult {
  changed: LibraryTextChange[];
  /** 이미 고친 곡 수. 고친 제목으로 찾았거나, 찾았지만 바꿀 글이 없었다 */
  alreadyFixed: number;
  /** 공식 라이브러리에 옛 제목으로도 고친 제목으로도 없는 항목 */
  unmatched: LibraryTextFix[];
}

type TextChanges = Partial<Pick<DeckDoc, "title" | "lyricsRaw" | "slides">>;

function replaceInLines(slide: unknown, from: string, to: string): unknown {
  if (typeof slide !== "object" || slide === null) return slide;
  const lines: unknown = (slide as { lines?: unknown }).lines;
  if (
    !Array.isArray(lines) ||
    !lines.some((line) => typeof line === "string" && line.includes(from))
  ) {
    return slide;
  }
  return {
    ...slide,
    lines: lines.map((line: unknown) =>
      typeof line === "string" ? line.replaceAll(from, to) : line,
    ),
  };
}

function replaceInSlides(raw: string, from: string, to: string): string {
  let slides: unknown;
  try {
    slides = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!Array.isArray(slides)) return raw;
  const next = slides.map((slide: unknown) => replaceInLines(slide, from, to));
  return next.some((slide, index) => slide !== slides[index])
    ? JSON.stringify(next)
    : raw;
}

function textChanges(deck: DeckDoc, fix: LibraryTextFix): TextChanges | null {
  const changes: TextChanges = {};
  if (fix.nextTitle !== undefined) {
    const title = clampText(fix.nextTitle, MAX_DECK_TITLE_LENGTH);
    if (title !== deck.title) changes.title = title;
  }
  if (fix.lyrics) {
    const { from, to } = fix.lyrics;
    const lyricsRaw = deck.lyricsRaw.replaceAll(from, to);
    const slides = replaceInSlides(deck.slides, from, to);
    if (lyricsRaw !== deck.lyricsRaw) changes.lyricsRaw = lyricsRaw;
    if (slides !== deck.slides) changes.slides = slides;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

function songKey(title: string, artist: string): string {
  return `${clampText(title, MAX_DECK_TITLE_LENGTH)}\u0000${clampText(artist, MAX_DECK_ARTIST_LENGTH)}`;
}

/**
 * 고칠 목록의 옛 제목을 고친 제목으로 바꾸는 함수를 만든다. 목록에 없는 곡은 받은 제목 그대로다.
 * `scripts/seedSelected.mjs`가 쓴다.
 *
 * 시드는 제목·아티스트가 같은 곡을 건너뛰어 여러 번 돌려도 곡이 겹치지 않는다. 그런데 고친 원본
 * (`data/cleaned/songs.json`)을 `fixLibraryText`보다 먼저 시드하면 고친 제목이 운영에 남은 옛 제목과
 * 달라 같은 곡이 하나 더 들어가고, 뒤에 옛 곡을 고치면 제목·아티스트까지 같은 곡이 둘이 된다. 그래서
 * 시드는 들어간 곡과 넣을 곡을 모두 고친 제목으로 견주고, 옛 제목으로 들어온 곡도 고친 제목으로 넣는다.
 * 운영에는 100자로 줄이기 전에 넣은 곡과 줄여 넣은 곡이 섞여 있어 줄인 제목·아티스트끼리 견준다.
 */
export function libraryTitleCorrector(
  fixes: readonly LibraryTextFix[],
): (title: string, artist: string) => string {
  const nextTitles = new Map<string, string>();
  for (const fix of fixes) {
    if (fix.nextTitle !== undefined) {
      nextTitles.set(songKey(fix.title, fix.artist), fix.nextTitle);
    }
  }
  return (title, artist) => nextTitles.get(songKey(title, artist)) ?? title;
}

async function findOfficialDecks(
  db: Db,
  title: string,
  artist: string,
): Promise<DeckDoc[]> {
  const artists = new Set([artist, clampText(artist, MAX_DECK_ARTIST_LENGTH)]);
  const titles = new Set([title, clampText(title, MAX_DECK_TITLE_LENGTH)]);
  const found = new Map<string, DeckDoc>();
  for (const candidate of titles) {
    const snapshot = await decksCol(db)
      .where("userId", "==", OFFICIAL_LIBRARY_USER_ID)
      .where("title", "==", candidate)
      .get();
    for (const doc of snapshot.docs) {
      const deck = doc.data();
      if (deck.presentationId === null && artists.has(deck.artist)) {
        found.set(deck.id, deck);
      }
    }
  }
  return [...found.values()];
}

async function applyFix(
  db: Db,
  deckId: string,
  fix: LibraryTextFix,
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = decksCol(db).doc(deckId);
    const deck = (await tx.get(ref)).data();
    const changes = deck && textChanges(deck, fix);
    if (!deck || !changes) return false;
    const { listed, searchGrams } = withDeckIndex({ ...deck, ...changes });
    tx.update(ref, { ...changes, listed, searchGrams });
    return true;
  });
}

/**
 * 공식 라이브러리(`OFFICIAL_LIBRARY_USER_ID`) 곡의 제목·가사를 고친다. 기본은 미리보기라
 * 아무것도 쓰지 않는다. `scripts/fixLibraryText.mjs`가 쓴다.
 *
 * 시드 원본(`data/cleaned/songs.json`)에 남았던 HTML 엔티티(`Love &amp; Grace`)와 파일 이름용으로
 * 바꾼 글자(`John 1_12`)가 그대로 운영에 들어가 모든 사용자에게 보인다. 원본을 고쳐도 시드 스크립트는
 * 이미 들어간 곡을 건너뛰기만 하므로(`libraryTitleCorrector`), 들어간 곡은 제자리에서 고친다.
 *
 * - 공식 계정의 보관함 곡만 고친다. 사용자가 가져간 곡과 같은 제목의 사용자 곡은 그 사람의 사본이라
 *   그대로 둔다.
 * - 곡은 운영에 넣은 그대로의 제목·아티스트로 찾는다. 운영에는 100자로 줄이기 전에 넣은 곡과 줄여
 *   넣은 곡이 섞여 있어 두 모양을 모두 찾는다. 주인·제목의 같음 조건만 써서 복합 색인이 필요 없고,
 *   아티스트와 사본 여부는 받아 온 뒤 거른다.
 * - 곡마다 트랜잭션 하나에서 다시 읽고 고치며, 고친 문서를 `withDeckIndex`에 통과시키고 바뀌는
 *   필드만 쓴다. 가사는 원문(`lyricsRaw`)과 슬라이드 줄에서 같은 글을 바꿔 슬라이드 나눔과 id를
 *   지킨다.
 * - 수정 시각은 그대로 둔다. 곡 주인이 고친 것이 아니고, 공유 라이브러리가 가져간 횟수가 같은 곡을
 *   수정 시각순으로 세우는데 고친 곡만 맨 위로 올라가면 안 된다.
 * - 고친 곡은 옛 제목으로 찾지 못하고 바꿀 글도 없으므로 다시 실행해도 쓰지 않는다.
 */
export async function fixLibraryText(
  db: Db,
  fixes: readonly LibraryTextFix[],
  { apply = false }: { apply?: boolean } = {},
): Promise<LibraryTextFixResult> {
  const result: LibraryTextFixResult = {
    changed: [],
    alreadyFixed: 0,
    unmatched: [],
  };
  for (const fix of fixes) {
    const decks = await findOfficialDecks(db, fix.title, fix.artist);
    if (decks.length === 0) {
      const fixed =
        fix.nextTitle !== undefined &&
        (await findOfficialDecks(db, fix.nextTitle, fix.artist)).length > 0;
      if (fixed) result.alreadyFixed += 1;
      else result.unmatched.push(fix);
      continue;
    }
    for (const deck of decks) {
      const changes = textChanges(deck, fix);
      if (!changes || (apply && !(await applyFix(db, deck.id, fix)))) {
        result.alreadyFixed += 1;
        continue;
      }
      result.changed.push({
        id: deck.id,
        title: deck.title,
        nextTitle: changes.title ?? deck.title,
        lyrics: changes.lyricsRaw !== undefined || changes.slides !== undefined,
      });
    }
  }
  return result;
}
