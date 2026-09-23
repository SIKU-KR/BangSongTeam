import { sanitizeLyricLine } from "./lyrics";

// ============================================================================
// 가사 정규화 순수 유틸 (PRD 4.8, TECH_SPEC §6.2)
//
// 모델 호출 자체는 Worker가 한다. 여기에는 입력을 만들고, 출력을 정리하고,
// 실패했을 때 쓸 버전을 고르는 결정론적 로직만 둔다.
// ============================================================================

/** 정규화 입력이 되는 루트 버전 1건 */
export interface RootVersion {
  lyrics: string;
  /** 등록 시각 (ISO 또는 epoch ms). 동률 판정에만 쓴다 */
  createdAt: string | number | Date;
}

/**
 * 절 사이 빈 줄을 통일한다 (PRD 4.8 정규화 규칙).
 * 줄 앞뒤 공백을 지우고, 연속된 빈 줄은 하나로, 앞뒤 빈 줄은 없앤다.
 */
export function normalizeLyricsText(text: string): string {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = sanitizeLyricLine(raw);
    if (line.length === 0) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    } else {
      out.push(line);
    }
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** 공백·빈 줄 차이를 무시한 가사 비교 키 (`verifyNormalization`과 같은 공백 규칙) */
function contentKey(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ""))
    .filter((line) => line.length > 0)
    .join("\n");
}

function toMillis(value: RootVersion["createdAt"]): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
}

/**
 * 가장 많은 사용자가 등록한 버전 (정규화 실패 시 폴백, PRD 4.8 검증).
 *
 * 띄어쓰기·빈 줄만 다른 버전은 같은 버전으로 센다. 동률이면 먼저 등록된 쪽을
 * 고른다 — 결정론적이어야 같은 입력에 매번 같은 대표 가사가 나온다.
 *
 * @returns 절 사이 빈 줄을 통일한 가사. 입력이 없으면 null
 */
export function pickPopularRoot(versions: RootVersion[]): string | null {
  if (versions.length === 0) return null;

  const groups = new Map<
    string,
    { count: number; earliest: number; lyrics: string }
  >();
  for (const version of versions) {
    const key = contentKey(version.lyrics);
    const at = toMillis(version.createdAt);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { count: 1, earliest: at, lyrics: version.lyrics });
    } else {
      group.count += 1;
      if (at < group.earliest) {
        group.earliest = at;
        group.lyrics = version.lyrics;
      }
    }
  }

  const winner = [...groups.values()].sort(
    (a, b) => b.count - a.count || a.earliest - b.earliest,
  )[0];
  return normalizeLyricsText(winner.lyrics);
}

/** TECH_SPEC §6.2 시스템 프롬프트. 모델을 바꾸면 정규화 품질을 다시 검증한다 */
export const NORMALIZATION_SYSTEM_PROMPT = [
  "You are an expert lyric editor for Korean church worship songs.",
  "Given multiple user-submitted versions of lyrics for the same song:",
  "1. Produce a single canonical lyric version.",
  "2. Follow majority voting for verse order, punctuation, and typos.",
  "3. Standardize blank lines between verses.",
  "4. CRITICAL: DO NOT invent, generate, or summarize ANY lyrics. Every single line in your output must match an existing line in the input versions.",
  "Output only the lyrics text. No titles, labels, explanations, or markdown.",
].join("\n");

export interface NormalizationMessage {
  role: "system" | "user";
  content: string;
}

/** 모델에 보낼 메시지. 버전마다 구분선을 두어 경계가 섞이지 않게 한다 */
export function buildNormalizationMessages(
  versions: string[],
): NormalizationMessage[] {
  const body = versions
    .map(
      (lyrics, i) =>
        `### Version ${i + 1}\n${normalizeLyricsText(lyrics)}\n### End of version ${i + 1}`,
    )
    .join("\n\n");
  return [
    { role: "system", content: NORMALIZATION_SYSTEM_PROMPT },
    {
      role: "user",
      content: `${body}\n\nReturn the single canonical version.`,
    },
  ];
}

/**
 * 모델 출력에서 가사만 남긴다.
 *
 * thinking off가 무시되면 `<think>…</think>`가 앞에 붙는다. 마크다운 코드펜스로
 * 감싸 오는 경우도 있다. 둘 다 걷어낸 뒤 절 사이 빈 줄을 통일한다.
 */
export function extractModelText(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // 닫히지 않은 think 블록(잘린 출력)은 통째로 버린다
  if (/<think>/i.test(text)) text = text.replace(/<think>[\s\S]*$/i, "");

  const fenced = text.match(/```[^\n]*\n([\s\S]*?)```/);
  if (fenced) text = fenced[1];

  return normalizeLyricsText(text);
}

function nonEmptyLineCount(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

/** 가장 짧은 입력 버전 대비 최소 줄 비율 */
const MIN_COMPLETENESS_RATIO = 0.8;

/**
 * 출력이 곡의 대부분을 담고 있는가.
 *
 * `verifyNormalization`은 '입력에 없는 줄'만 잡는다. 모델이 곡의 절반만 내놓으면
 * 모든 줄이 입력에 있으므로 통과해 버린다. 다수결로 소수 버전의 줄이 빠질 수는
 * 있으니, 가장 짧은 입력 버전의 80%를 하한으로 둔다.
 */
export function isPlausiblyComplete(
  candidate: string,
  versions: string[],
): boolean {
  if (versions.length === 0) return false;
  const shortest = Math.min(...versions.map(nonEmptyLineCount));
  return (
    nonEmptyLineCount(candidate) >=
    Math.floor(shortest * MIN_COMPLETENESS_RATIO)
  );
}

/**
 * 출력 토큰 상한. 한국어는 글자당 1~2토큰이라 가장 긴 버전 글자 수의 1.5배에
 * 여유를 더한다. 너무 작으면 잘리고(`length` → 폴백), 너무 크면 비용이 는다.
 */
export function suggestMaxTokens(versions: string[]): number {
  const longest = Math.max(0, ...versions.map((v) => v.length));
  return Math.min(4096, Math.max(512, Math.ceil(longest * 1.5) + 256));
}
