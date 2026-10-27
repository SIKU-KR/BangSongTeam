import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DATA_DIR = path.resolve(import.meta.dirname, "..", "data");

interface Song {
  title: string;
  artist: string;
  lyrics: string;
}

interface Fix {
  title: string;
  artist: string;
  nextTitle?: string;
  lyrics?: { from: string; to: string };
}

const readJson = <T>(...parts: string[]): T =>
  JSON.parse(fs.readFileSync(path.join(DATA_DIR, ...parts), "utf-8")) as T;

const SONG_FILES = ["songs.json", "worship.json", "hymns.json"];
const HTML_ENTITY = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i;

describe("공식 라이브러리 곡 데이터 (data/cleaned)", () => {
  for (const file of SONG_FILES) {
    describe(file, () => {
      const songs = readJson<Song[]>("cleaned", file);

      it("제목·아티스트·가사에 HTML 엔티티가 남지 않는다", () => {
        const encoded = songs.filter((song) =>
          [song.title, song.artist, song.lyrics].some((text) =>
            HTML_ENTITY.test(text),
          ),
        );

        expect(encoded.map((song) => song.title)).toEqual([]);
      });

      it("제목에 파일 이름용으로 바꾼 _가 남지 않는다", () => {
        expect(
          songs.filter((song) => song.title.includes("_")).map((s) => s.title),
        ).toEqual([]);
      });
    });
  }

  it("같은 제목·아티스트의 곡이 겹치지 않는다", () => {
    const songs = readJson<Song[]>("cleaned", "songs.json");
    const keys = songs.map((song) => `${song.title}\u0000${song.artist}`);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("공식 라이브러리 고칠 목록 (data/officialLibraryFixes.json)", () => {
  const songs = readJson<Song[]>("cleaned", "songs.json");
  const fixes = () => readJson<Fix[]>("officialLibraryFixes.json");
  const find = (title: string, artist: string) =>
    songs.find((song) => song.title === title && song.artist === artist);

  it("바꿀 제목과 가사는 data/cleaned/songs.json의 고친 곡과 같다", () => {
    for (const fix of fixes()) {
      const fixed = find(fix.nextTitle ?? fix.title, fix.artist);
      expect(fixed, fix.title).toBeDefined();
      if (fix.nextTitle !== undefined) {
        expect(find(fix.title, fix.artist), fix.title).toBeUndefined();
      }
      if (fix.lyrics) {
        expect(fixed?.lyrics).toContain(fix.lyrics.to);
        expect(fixed?.lyrics).not.toContain(fix.lyrics.from);
      }
    }
  });

  it("엔티티와 _가 남았던 곡을 모두 담는다", () => {
    expect(fixes().filter((fix) => fix.nextTitle !== undefined)).toHaveLength(
      143,
    );
    expect(fixes().filter((fix) => fix.lyrics !== undefined)).toEqual([
      {
        title: "성령이 오셨네",
        artist: "김도현",
        lyrics: { from: "진리&#47504; 영이신", to: "진리의 영이신" },
      },
    ]);
  });
});
