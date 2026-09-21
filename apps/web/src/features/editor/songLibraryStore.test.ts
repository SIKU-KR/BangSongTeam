import { describe, it, expect, beforeEach } from "vitest";
import {
  getUserSongs,
  saveSongToLibrary,
  deleteUserSong,
  resetSongLibraryStore,
  getAvailableSongs,
} from "./songLibraryStore";

describe("songLibraryStore", () => {
  beforeEach(() => {
    resetSongLibraryStore();
  });

  it("새로운 곡을 저장하고 내 곡 목록에서 조회할 수 있어야 한다", () => {
    expect(getUserSongs()).toEqual([]);

    const saved = saveSongToLibrary({
      title: "꽃들도",
      artist: "JWorship",
      lyricsRaw: "이곳에 생명 샘 솟아나\n눈물 골짝 지나갈 때에",
    });

    expect(saved.id).toBeDefined();
    expect(saved.title).toBe("꽃들도");
    expect(saved.artist).toBe("JWorship");
    expect(saved.slides.length).toBeGreaterThan(0);

    const userSongs = getUserSongs();
    expect(userSongs.length).toBe(1);
    expect(userSongs[0].title).toBe("꽃들도");
  });

  it("getAvailableSongs()는 내 곡과 커뮤니티 곡을 함께 제공해야 한다", () => {
    const initialAvailable = getAvailableSongs();
    expect(initialAvailable.length).toBeGreaterThan(0);
    expect(initialAvailable.every((s) => s.source === "community")).toBe(true);

    saveSongToLibrary({
      title: "은혜 아래 있네",
      artist: "마커스",
      lyricsRaw: "주의 은혜 아래 나 거하며",
    });

    const updated = getAvailableSongs();
    expect(updated[0].deck.title).toBe("은혜 아래 있네");
    expect(updated[0].source).toBe("mine");
  });

  it("저장된 곡을 삭제할 수 있어야 한다", () => {
    const saved = saveSongToLibrary({
      title: "삭제할 곡",
      lyricsRaw: "가사 한 줄",
    });

    expect(getUserSongs().length).toBe(1);

    deleteUserSong(saved.id);
    expect(getUserSongs().length).toBe(0);
  });
});
