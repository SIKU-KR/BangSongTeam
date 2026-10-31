import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GasazipUnavailableError,
  cleanGasazipLyrics,
  decodeHtmlEntities,
  fetchGasazipSong,
  parseGasazipSearch,
  parseGasazipSong,
  searchGasazip,
} from "./gasazip";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("decodeHtmlEntities", () => {
  it("숫자·16진수·이름 엔티티를 풀고 엔티티 앞 역슬래시를 지운다", () => {
    expect(
      decodeHtmlEntities("Don\\&#039;t &amp; &#x41;&#47504;&nbsp;&lt;"),
    ).toBe("Don't & A릐 <");
  });

  it("모르는 이름과 글자가 될 수 없는 코드는 그대로 두고 한 겹만 푼다", () => {
    expect(decodeHtmlEntities("&foo; &#1114112; &#55296; &amp;lt;")).toBe(
      "&foo; &#1114112; &#55296; &lt;",
    );
  });
});

describe("parseGasazipSearch", () => {
  it("결과 행의 곡 번호, 제목, 가수를 순서대로 읽고 다른 링크는 건너뛴다", () => {
    expect(parseGasazipSearch(fixture("gasazip-search.html"))).toEqual([
      { id: "3087953", title: "은혜 은혜", artist: "정소영" },
      { id: "3077616", title: "은혜 은혜", artist: "박진희" },
      { id: "2716460", title: "은혜 위에 은혜", artist: "해준" },
    ]);
  });

  it("엔티티를 풀고 잡음 행도 원문 그대로 돌려준다", () => {
    const rows = parseGasazipSearch(fixture("gasazip-search-noisy.html"));

    expect(rows).toHaveLength(5);
    expect(rows[2].title).toBe("020. 잔나비 - 주저하는 연인들을 위해.mp3");
    expect(rows[3].title).toBe("(꽃천사루루님)잔나비");
    expect(rows[4]).toEqual({
      id: "3111111",
      title: "나는 볼 수 없던 이야기('19 로맨스는 별책부록 OST, Part 1)",
      artist: "잔나비 & 친구들",
    });
  });

  it("결과가 없으면 빈 배열이다", () => {
    expect(parseGasazipSearch(fixture("gasazip-search-none.html"))).toEqual([]);
  });
});

describe("parseGasazipSong", () => {
  it("제목과 가수를 읽고 가사의 빈 줄을 모두 없앤다", () => {
    expect(parseGasazipSong(fixture("gasazip-song.html"))).toEqual({
      title: "은혜 위에 은혜",
      artist: "해준",
      lyrics: [
        "어두워진 나의 눈 바라 볼 수 없네",
        "부끄러운 내 입술 말할 수 없네",
        "나의 주님 내게 다가와",
        "돌같은 내 마음 느낄 수 없네",
        "은혜 위에 은혜 내 영을 감동해",
        "놀라운 주의 사랑 나를 새롭게 하네",
        "나를 향한 주의 은혜 위에 은혜",
      ].join("\n"),
    });
  });

  it("#gasa-desktop이 없으면 #gasa-copy를 쓰고 태그와 엔티티를 정리한다", () => {
    expect(parseGasazipSong(fixture("gasazip-song-copy-only.html"))).toEqual({
      title: "Love & Grace",
      artist: "Don't Stop <Band>",
      lyrics: "I don't care 릐\nPraise & worship",
    });
  });

  it("가사가 공백과 줄바꿈뿐이면 null이다", () => {
    expect(parseGasazipSong(fixture("gasazip-song-empty.html"))).toEqual({
      title: "가사 없는 곡",
      artist: "누군가",
      lyrics: null,
    });
  });
});

describe("cleanGasazipLyrics", () => {
  it("전각 공백을 줄 끝에서 지우고 길이 한도로 자른다", () => {
    expect(cleanGasazipLyrics("　가 <br />\r\n나 <br/>")).toBe("가\n나");
    expect(cleanGasazipLyrics("가".repeat(20_000))).toHaveLength(10_000);
  });
});

describe("gasazip 요청", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("검색은 제목 검색 첫 쪽을 앱을 밝힌 User-Agent로 부른다", async () => {
    const fetchMock = vi.fn(
      async () => new Response(fixture("gasazip-search.html")),
    );
    vi.stubGlobal("fetch", fetchMock);

    const rows = await searchGasazip("은혜 위에 은혜");

    expect(rows).toHaveLength(3);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://gasazip.com/search.html",
    );
    expect(parsed.searchParams.get("q")).toBe("은혜 위에 은혜");
    expect(parsed.searchParams.get("type")).toBe("title");
    expect(parsed.searchParams.get("p")).toBe("1");
    expect((init.headers as Record<string, string>)["user-agent"]).toMatch(
      /^BangSongTeam/,
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("곡 페이지가 404면 null이다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("없어요", { status: 404 })),
    );

    expect(await fetchGasazipSong("1")).toBeNull();
  });

  it("5xx와 네트워크 오류는 GasazipUnavailableError다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    await expect(fetchGasazipSong("1")).rejects.toBeInstanceOf(
      GasazipUnavailableError,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timeout", "TimeoutError");
      }),
    );
    await expect(searchGasazip("은혜")).rejects.toBeInstanceOf(
      GasazipUnavailableError,
    );
  });
});
