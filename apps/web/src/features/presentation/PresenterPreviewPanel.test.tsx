import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SEED_PRESENTATIONS } from "./mockPresentations";
import { PresenterPreviewPanel } from "./PresenterPreviewPanel";

const SONGS = SEED_PRESENTATIONS[0].items;

function renderPanel(songIndex: number, slideIndex: number) {
  return render(
    <PresenterPreviewPanel
      songs={SONGS}
      position={{ songIndex, slideIndex }}
      isBlackout={false}
      isLyricsHidden={false}
    />,
  );
}

describe("PresenterPreviewPanel", () => {
  it("현재 위치를 곡.슬라이드 번호와 제목으로 표시한다", () => {
    renderPanel(1, 2);

    expect(screen.getByTestId("presenter-current-label")).toHaveTextContent(
      `2.3 ${SONGS[1].deck!.title}`,
    );
  });

  it("다음 슬라이드 번호를 함께 보여 준다", () => {
    renderPanel(0, 0);

    expect(screen.getByTestId("presenter-next-label")).toHaveTextContent("1.2");
  });

  it("다음이 새 곡이면 곡 제목을 붙인다", () => {
    const firstSong = SONGS[0].deck!;
    renderPanel(0, firstSong.slides.length - 1);

    expect(screen.getByTestId("presenter-next-label")).toHaveTextContent(
      SONGS[1].deck!.title,
    );
  });

  it("세트 마지막에서는 다음 자리에 안내를 보여 준다", () => {
    const lastSongIndex = SONGS.length - 1;
    const lastSlideIndex = SONGS[lastSongIndex].deck!.slides.length - 1;

    renderPanel(lastSongIndex, lastSlideIndex);

    expect(screen.getByTestId("presenter-next-label")).toHaveTextContent("—");
    expect(screen.getByText("마지막 슬라이드입니다")).toBeInTheDocument();
  });

  it("현재·다음 두 스테이지를 모두 그린다", () => {
    renderPanel(0, 0);

    expect(screen.getByTestId("presenter-current-stage")).toBeInTheDocument();
    expect(screen.getByTestId("presenter-next-stage")).toBeInTheDocument();
  });
});
