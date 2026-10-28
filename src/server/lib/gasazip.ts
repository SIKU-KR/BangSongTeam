import {
  MAX_DECK_ARTIST_LENGTH,
  MAX_DECK_TITLE_LENGTH,
  MAX_LYRICS_LENGTH,
  clampText,
  sanitizeLyricLine,
} from "#shared";

const GASAZIP_ORIGIN = "https://gasazip.com";
const REQUEST_TIMEOUT_MS = 5_000;
const USER_AGENT = "BangSongTeam-LyricsImport/1.0";

export interface GasazipRow {
  id: string;
  title: string;
  artist: string;
}

export interface GasazipSong {
  title: string;
  artist: string;
  lyrics: string | null;
}

/** gasazip에 닿지 못했거나(시간 초과 포함) 기대한 응답을 받지 못했다 */
export class GasazipUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GasazipUnavailableError";
  }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const ENTITY = /\\?&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g;

function fromCodePoint(codePoint: number, entity: string): string {
  const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
  return codePoint > 0x10ffff || isSurrogate
    ? entity
    : String.fromCodePoint(codePoint);
}

/**
 * HTML 엔티티를 글자로 바꾼다. gasazip은 `&#039;`를 `\&#039;`처럼 앞에 역슬래시를 붙여 내보내는
 * 곡이 있어, 엔티티 바로 앞의 역슬래시도 함께 지운다.
 *
 * 한 번에 한 겹만 푼다. 모르는 이름과 글자가 될 수 없는 코드는 그대로 둔다.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    ENTITY,
    (match, decimal?: string, hex?: string, name?: string) => {
      const entity = match.startsWith("\\") ? match.slice(1) : match;
      if (decimal !== undefined) {
        return fromCodePoint(Number.parseInt(decimal, 10), entity);
      }
      if (hex !== undefined) {
        return fromCodePoint(Number.parseInt(hex, 16), entity);
      }
      return (
        (name !== undefined && Object.hasOwn(NAMED_ENTITIES, name)
          ? NAMED_ENTITIES[name]
          : undefined) ?? entity
      );
    },
  );
}

function plainText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * gasazip 검색 결과 HTML에서 곡 행(`a.gz-candy-song-row`)을 읽는다. 제목이 빈 행은 건너뛴다. 정리와 중복 묶기는 `rankLyricsCandidates`가 한다.
 */
export function parseGasazipSearch(html: string): GasazipRow[] {
  const rows: GasazipRow[] = [];
  const anchor =
    /<a\s[^>]*href="\/(\d+)"[^>]*gz-candy-song-row[^>]*>([\s\S]*?)<\/a>/g;
  for (const [, id, body = ""] of html.matchAll(anchor)) {
    const title = plainText(
      /<strong>([\s\S]*?)<\/strong>/.exec(body)?.[1] ?? "",
    );
    const artist = plainText(/<em>([\s\S]*?)<\/em>/.exec(body)?.[1] ?? "");
    if (id && title) rows.push({ id, title, artist });
  }
  return rows;
}

/**
 * 가사 HTML 조각을 슬라이드로 나눌 글로 바꾼다. `<br>`를 줄바꿈으로 읽고, 줄마다 앞뒤 공백을
 * 지운 뒤 빈 줄을 모두 없앤다. 곡마다 빈 줄 쓰임이 제각각이라 단락 나눔을 믿을 수 없다.
 * 가사가 비면 `null`이다.
 */
export function cleanGasazipLyrics(html: string): string | null {
  const text = decodeHtmlEntities(
    html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""),
  );
  const lines = text
    .split(/\r\n|\r|\n/)
    .map(sanitizeLyricLine)
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  return clampText(lines.join("\n"), MAX_LYRICS_LENGTH);
}

function elementHtml(html: string, tag: string, id: string): string | null {
  const open = new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>`);
  const start = open.exec(html);
  if (!start) return null;
  const from = start.index + start[0].length;
  const end = html.indexOf(`</${tag}>`, from);
  return end < 0 ? null : html.slice(from, end);
}

/** 곡 페이지 HTML에서 제목, 가수, 가사를 읽는다. 가사는 `#gasa-desktop`을 먼저, 비었으면 `#gasa-copy`를 쓴다. */
export function parseGasazipSong(html: string): GasazipSong {
  const title = plainText(elementHtml(html, "h1", "gasatitle") ?? "");
  const artist = plainText(elementHtml(html, "div", "gasasinger") ?? "");
  const lyrics =
    cleanGasazipLyrics(elementHtml(html, "div", "gasa-desktop") ?? "") ??
    cleanGasazipLyrics(elementHtml(html, "div", "gasa-copy") ?? "");
  return {
    title: clampText(title, MAX_DECK_TITLE_LENGTH),
    artist: clampText(artist, MAX_DECK_ARTIST_LENGTH),
    lyrics,
  };
}

async function fetchHtml(url: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new GasazipUnavailableError("gasazip request failed", {
      cause: error,
    });
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new GasazipUnavailableError(`gasazip responded ${response.status}`);
  }
  try {
    return await response.text();
  } catch (error) {
    throw new GasazipUnavailableError("gasazip body unreadable", {
      cause: error,
    });
  }
}

/** 제목 검색 첫 쪽(30건)의 곡 행. 결과가 없으면 빈 배열이다. */
export async function searchGasazip(title: string): Promise<GasazipRow[]> {
  const query = new URLSearchParams({ q: title, type: "title", p: "1" });
  const html = await fetchHtml(`${GASAZIP_ORIGIN}/search.html?${query}`);
  return html === null ? [] : parseGasazipSearch(html);
}

/** 곡 한 편. 없는 번호(404)면 `null`이다. */
export async function fetchGasazipSong(
  id: string,
): Promise<GasazipSong | null> {
  const html = await fetchHtml(`${GASAZIP_ORIGIN}/${id}`);
  return html === null ? null : parseGasazipSong(html);
}
