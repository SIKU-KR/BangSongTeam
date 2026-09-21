import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SongPickerModal } from "./SongPickerModal";
import { resetSongLibraryStore } from "./songLibraryStore";

describe("SongPickerModal", () => {
  const onSelectSongMock = vi.fn();
  const onCloseMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetSongLibraryStore();
  });

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

  it("가사 복사 버튼을 누르면 복사 상태 텍스트가 표시된다", async () => {
    // navigator.clipboard 모킹
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

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
      target: { value: "은혜로다 주의 은혜\n한량없는 주의 은혜\n\n나를 살리신 주" },
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
});
