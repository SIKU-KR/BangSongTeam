import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SEED_PRESENTATIONS } from "./mockPresentations";
import { PresenterJumpPanel } from "./PresenterJumpPanel";

const SONGS = SEED_PRESENTATIONS[0].items;

function renderPanel(songIndex = 0, slideIndex = 0) {
  const onJump = vi.fn();
  render(
    <PresenterJumpPanel
      songs={SONGS}
      position={{ songIndex, slideIndex }}
      onJump={onJump}
    />,
  );
  return onJump;
}

describe("PresenterJumpPanel", () => {
  it("곡 머리에는 키패드로 칠 수 없는 곡 서수를 붙이지 않는다", () => {
    renderPanel();

    const title = SONGS[0].deck!.title;
    expect(
      screen
        .getByTestId("presenter-jump-song-0")
        .textContent?.startsWith(title),
    ).toBe(true);
  });

  it("슬라이드 칩은 세트 전체에서 1부터 이어지는 번호를 매긴다", () => {
    renderPanel();

    // 숫자 키패드로 치는 N과 화면 번호가 같아야 한다 (PPT식, PRD 5).
    const firstSongSlides = SONGS[0].deck!.slides.length;
    expect(screen.getByTestId("presenter-jump-slide-0-0")).toHaveTextContent(
      /^1$/,
    );
    expect(screen.getByTestId("presenter-jump-slide-0-2")).toHaveTextContent(
      /^3$/,
    );
    // 두 번째 곡은 1이 아니라 앞 곡에 이어서 시작한다
    expect(screen.getByTestId("presenter-jump-slide-1-0")).toHaveTextContent(
      new RegExp(`^${firstSongSlides + 1}$`),
    );
  });

  it("곡을 누르면 그 곡의 첫 슬라이드로 점프한다", () => {
    const onJump = renderPanel();

    fireEvent.click(screen.getByTestId("presenter-jump-song-2"));

    expect(onJump).toHaveBeenCalledWith(2, 0);
  });

  it("슬라이드 칩을 누르면 그 위치로 점프한다", () => {
    const onJump = renderPanel();

    fireEvent.click(screen.getByTestId("presenter-jump-slide-1-2"));

    expect(onJump).toHaveBeenCalledWith(1, 2);
  });

  it("세트의 모든 곡을 나열한다", () => {
    renderPanel();

    expect(screen.getAllByTestId("presenter-jump-song")).toHaveLength(
      SONGS.length,
    );
  });
});
