import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../../lib/storage";
import { SongPickerModal } from "./SongPickerModal";
import { resetSongLibraryStore, saveSongToLibrary } from "./songLibraryStore";

describe("SongPickerModal", () => {
  const onSelectSongMock = vi.fn();
  const onCloseMock = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    closeOfflineDB();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    await resetSongLibraryStore();
  });

  afterEach(closeOfflineDB);

  /** 내 보관함 곡 1개를 만들어 목록 맨 앞(기본 선택)에 오게 한다 */
  function seedMySong(title = "내가 만든 찬양") {
    return saveSongToLibrary({
      title,
      artist: "본인",
      lyricsRaw: "첫째 줄\n둘째 줄\n\n셋째 줄\n넷째 줄",
    });
  }

  it("isOpen=false 일 때는 아무것도 렌더링하지 않는다", () => {
    const { container } = render(
      <SongPickerModal
        isOpen={false}
        onClose={onCloseMock}
        onSelectSong={onSelectSongMock}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("isOpen=true 일 때 모달 헤더와 기본 곡 목록을 렌더링한다", () => {
    render(
      <SongPickerModal
        isOpen={true}
        onClose={onCloseMock}
        onSelectSong={onSelectSongMock}
      />,
    );

    expect(screen.getByTestId("song-picker-modal")).toBeInTheDocument();
    expect(screen.getByText("찬양곡 추가")).toBeInTheDocument();
    expect(screen.getAllByText("시간을 뚫고").length).toBeGreaterThan(0);
  });

  it("한글 검색어로 곡 목록을 필터링할 수 있다", () => {
    render(
      <SongPickerModal
        isOpen={true}
        onClose={onCloseMock}
        onSelectSong={onSelectSongMock}
      />,
    );

    const searchInput = screen.getByTestId("song-picker-search-input");
    fireEvent.change(searchInput, { target: { value: "시간" } });

    expect(screen.getAllByText("시간을 뚫고").length).toBeGreaterThan(0);
    expect(screen.queryByText("소원")).not.toBeInTheDocument();
  });

  it("곡을 선택하고 '이 곡을 프레젠테이션에 추가'를 클릭하면 onSelectSong이 호출된다", () => {
    render(
      <SongPickerModal
        isOpen={true}
        onClose={onCloseMock}
        onSelectSong={onSelectSongMock}
      />,
    );

    // 기본으로 첫 번째 곡 선택 상태
    const addBtn = screen.getByTestId("song-picker-add-btn");
    fireEvent.click(addBtn);

    expect(onSelectSongMock).toHaveBeenCalledTimes(1);
    expect(onSelectSongMock.mock.calls[0][0].title).toBe("시간을 뚫고");
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it("내 보관함 곡은 가사 복사 버튼을 제공한다", async () => {
    // navigator.clipboard 모킹
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    seedMySong();

    render(
      <SongPickerModal
        isOpen={true}
        onClose={onCloseMock}
        onSelectSong={onSelectSongMock}
      />,
    );

    const copyBtn = screen.getByTestId("song-picker-copy-lyrics-btn");
    fireEvent.click(copyBtn);

    expect(await screen.findByText("가사 복사됨 ✓")).toBeInTheDocument();
  });

  it("새 가사 직접 입력을 통해 곡을 생성하고 추가할 수 있다", async () => {
    render(
      <SongPickerModal
        isOpen={true}
        onClose={onCloseMock}
        onSelectSong={onSelectSongMock}
      />,
    );

    const switchCreateBtn = screen.getByTestId("song-picker-switch-create-btn");
    fireEvent.click(switchCreateBtn);

    const titleInput = screen.getByTestId("song-picker-create-title-input");
    const artistInput = screen.getByTestId("song-picker-create-artist-input");
    const lyricsInput = screen.getByTestId("song-picker-create-lyrics-input");

    fireEvent.change(titleInput, { target: { value: "새로운 찬양" } });
    fireEvent.change(artistInput, { target: { value: "사명자" } });
    fireEvent.change(lyricsInput, {
      target: {
        value: "은혜로다 주의 은혜\n한량없는 주의 은혜\n\n나를 살리신 주",
      },
    });

    const submitBtn = screen.getByTestId("song-picker-create-submit-btn");
    expect(submitBtn).toBeEnabled();

    fireEvent.click(submitBtn);

    expect(onSelectSongMock).toHaveBeenCalledTimes(1);
    const addedSong = onSelectSongMock.mock.calls[0][0];
    expect(addedSong.title).toBe("새로운 찬양");
    expect(addedSong.artist).toBe("사명자");
    expect(addedSong.slides.length).toBe(2);
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  describe("공유 찬양 가사 전문 노출 및 검색 (에디터 내 전면 제공)", () => {
    it("공유 곡도 가사 전체 슬라이드를 미리 보여준다", () => {
      render(
        <SongPickerModal
          isOpen={true}
          onClose={onCloseMock}
          onSelectSong={onSelectSongMock}
        />,
      );

      // 기본 선택은 공유 곡(시간을 뚫고)
      expect(screen.getByText("당신은 시간을 뚫고")).toBeInTheDocument();
      // 둘째 슬라이드 이후 가사도 정상 노출된다
      expect(
        screen.getByText("우리 없는 하늘을 원치 않아"),
      ).toBeInTheDocument();
      expect(screen.getByText("빛으로 오신 주 예수")).toBeInTheDocument();
    });

    it("공유 곡에도 가사 복사 버튼을 제공한다", () => {
      render(
        <SongPickerModal
          isOpen={true}
          onClose={onCloseMock}
          onSelectSong={onSelectSongMock}
        />,
      );

      expect(
        screen.getByTestId("song-picker-copy-lyrics-btn"),
      ).toBeInTheDocument();
    });

    it("내 보관함 곡은 전문을 그대로 보여준다", () => {
      seedMySong();

      render(
        <SongPickerModal
          isOpen={true}
          onClose={onCloseMock}
          onSelectSong={onSelectSongMock}
        />,
      );

      expect(screen.getByText("넷째 줄")).toBeInTheDocument();
    });

    it("공유 곡도 가사 본문으로 검색할 수 있다", () => {
      render(
        <SongPickerModal
          isOpen={true}
          onClose={onCloseMock}
          onSelectSong={onSelectSongMock}
        />,
      );

      const searchInput = screen.getByTestId("song-picker-search-input");
      // '시간을 뚫고'의 2번째 슬라이드에만 있는 구절로 검색
      fireEvent.change(searchInput, {
        target: { value: "우리 없는 하늘을" },
      });

      expect(screen.getAllByText("시간을 뚫고").length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });
});
