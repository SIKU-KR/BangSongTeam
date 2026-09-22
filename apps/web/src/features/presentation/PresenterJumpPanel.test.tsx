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
  it("곡마다 1부터 시작하는 번호를 보여 준다", () => {
    renderPanel();

    // 숫자 키패드로 치는 N.M과 화면 번호가 같아야 한다 (PRD 5).
    expect(screen.getByTestId("presenter-jump-song-0")).toHaveTextContent("1.");
    expect(screen.getByTestId("presenter-jump-song-1")).toHaveTextContent("2.");
  });

  it("슬라이드 칩도 1부터 번호를 매긴다", () => {
    renderPanel();

    expect(screen.getByTestId("presenter-jump-slide-0-0")).toHaveTextContent(
      "1",
    );
    expect(screen.getByTestId("presenter-jump-slide-0-2")).toHaveTextContent(
      "3",
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
