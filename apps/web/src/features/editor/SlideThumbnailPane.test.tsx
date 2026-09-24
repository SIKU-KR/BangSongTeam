import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PresentationItem } from "@repo/shared";
import { DEFAULT_DECK_STYLE } from "@repo/shared";
import {
  SlideThumbnailPane,
  type SlideThumbnailPaneProps,
} from "./SlideThumbnailPane";

/** slideCounts로 간단한 세트를 만든다 */
function makeItems(slideCounts: number[]): PresentationItem[] {
  return slideCounts.map(
    (count, songIndex) =>
      ({
        id: `item-${songIndex}`,
        presentationId: "p",
        deckId: `deck-${songIndex}`,
        order: songIndex,
        deck: {
          id: `deck-${songIndex}`,
          title: `곡${songIndex + 1}`,
          artist: "",
          style: DEFAULT_DECK_STYLE,
          backgroundId: null,
          slides: Array.from({ length: count }, (_, slideIndex) => ({
            id: `s-${songIndex}-${slideIndex}`,
            order: slideIndex,
            lines: [`곡${songIndex + 1} 슬라이드${slideIndex + 1}`],
          })),
        },
      }) as unknown as PresentationItem,
  );
}

function renderPane(overrides: Partial<SlideThumbnailPaneProps> = {}) {
  const props: SlideThumbnailPaneProps = {
    items: makeItems([3, 1, 2]),
    activeSongIndex: 0,
    activeSlideIndex: 0,
    onSelectSlide: vi.fn(),
    onAddSlide: vi.fn(),
    onDuplicateSlide: vi.fn(),
    onDeleteSlide: vi.fn(),
    onReorderSlide: vi.fn(),
    onReorderSong: vi.fn(),
    onDuplicateSong: vi.fn(),
    onDeleteSong: vi.fn(),
    onOpenSongPicker: vi.fn(),
    ...overrides,
  };
  const utils = render(<SlideThumbnailPane {...props} />);
  return { ...utils, props };
}

describe("SlideThumbnailPane (PPT식 썸네일 창)", () => {
  it("세트 전체 슬라이드를 1부터 이어지는 번호로 보여 준다", () => {
    renderPane();

    // [3, 1, 2] → 1곡 1~3, 2곡 4, 3곡 5~6
    expect(screen.getByTestId("slide-thumb-0")).toHaveTextContent("1");
    expect(screen.getByTestId("slide-thumb-3")).toHaveTextContent("4");
    expect(screen.getByTestId("slide-thumb-4")).toHaveTextContent("5");
    expect(screen.getByTestId("slide-thumb-5")).toHaveTextContent("6");
    expect(screen.queryByTestId("slide-thumb-6")).not.toBeInTheDocument();
    expect(screen.getByTestId("slide-thumbnail-pane")).toHaveTextContent(
      "슬라이드 6",
    );
  });

  it("썸네일은 영상 대신 정지 배경으로 그린다", () => {
    const { container } = renderPane();

    expect(container.querySelector("video")).toBeNull();
    expect(screen.getAllByTestId("static-background-layer")).toHaveLength(6);
  });

  it("썸네일 클릭은 (곡, 곡 안 슬라이드) 위치로 선택을 알린다", () => {
    const { props } = renderPane();

    fireEvent.click(screen.getByTestId("slide-thumb-4"));
    expect(props.onSelectSlide).toHaveBeenCalledWith(2, 0);

    fireEvent.click(screen.getByTestId("song-section-title-1"));
    expect(props.onSelectSlide).toHaveBeenLastCalledWith(1, 0);
  });

  it("선택 슬라이드를 aria-current로 표시한다", () => {
    renderPane({ activeSongIndex: 2, activeSlideIndex: 1 });

    expect(screen.getByTestId("slide-thumb-5")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByTestId("slide-thumb-0")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("복제·삭제 버튼은 (곡, 슬라이드)를 넘기고, 1장짜리 곡에는 삭제가 없다", () => {
    const { props } = renderPane();

    fireEvent.click(screen.getByTestId("duplicate-slide-btn-5"));
    expect(props.onDuplicateSlide).toHaveBeenCalledWith(2, 1);
    expect(props.onSelectSlide).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("delete-slide-btn-1"));
    expect(props.onDeleteSlide).toHaveBeenCalledWith(0, 1);

    // 2곡은 1장뿐 → 삭제 불가 (곡 삭제는 구역 메뉴에서)
    expect(screen.queryByTestId("delete-slide-btn-3")).not.toBeInTheDocument();
    expect(screen.getByTestId("duplicate-slide-btn-3")).toBeInTheDocument();
  });

  it("구역 메뉴는 ⋯ 또는 우클릭으로 열리고, 바깥 클릭·Esc로 닫힌다", () => {
    renderPane();

    fireEvent.click(screen.getByTestId("song-section-menu-btn-0"));
    expect(screen.getByTestId("song-section-menu")).toBeInTheDocument();
    // 첫 곡은 위로 이동 불가
    expect(screen.getByRole("menuitem", { name: "위로 이동" })).toBeDisabled();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("song-section-menu")).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId("song-section-2"));
    expect(
      screen.getByRole("menuitem", { name: "아래로 이동" }),
    ).toBeDisabled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("song-section-menu")).not.toBeInTheDocument();
  });

  it("구역 메뉴 항목은 곡 동작을 호출하고 메뉴를 닫는다", () => {
    const { props } = renderPane();

    fireEvent.click(screen.getByTestId("song-section-menu-btn-1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "위로 이동" }));
    expect(props.onReorderSong).toHaveBeenCalledWith(1, 0);
    expect(screen.queryByTestId("song-section-menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("song-section-menu-btn-1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "곡 복제" }));
    expect(props.onDuplicateSong).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByTestId("song-section-menu-btn-1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "곡 삭제" }));
    expect(props.onDeleteSong).toHaveBeenCalledWith(1);
  });

  it("곡이 하나뿐이면 곡 삭제 메뉴가 없다", () => {
    renderPane({ items: makeItems([2]) });

    fireEvent.click(screen.getByTestId("song-section-menu-btn-0"));
    expect(
      screen.queryByRole("menuitem", { name: "곡 삭제" }),
    ).not.toBeInTheDocument();
  });

  it("선택이 접힌 구역으로 옮겨 가면 그 구역을 펼친다", () => {
    const { props, rerender } = renderPane();

    fireEvent.click(screen.getByTestId("song-section-toggle-2"));
    expect(screen.queryByTestId("slide-thumb-4")).not.toBeInTheDocument();

    rerender(
      <SlideThumbnailPane
        {...props}
        activeSongIndex={2}
        activeSlideIndex={0}
      />,
    );
    expect(screen.getByTestId("slide-thumb-4")).toBeInTheDocument();
  });

  it("새 슬라이드·찬양곡 추가 버튼", () => {
    const { props } = renderPane();

    fireEvent.click(screen.getByTestId("add-slide-btn"));
    expect(props.onAddSlide).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("add-song-btn"));
    expect(props.onOpenSongPicker).toHaveBeenCalledTimes(1);
  });

  it("곡이 없으면 안내를 보여 주고 새 슬라이드는 비활성이다", () => {
    renderPane({ items: [] });

    expect(screen.getByText(/아직 곡이 없습니다/)).toBeInTheDocument();
    expect(screen.getByTestId("add-slide-btn")).toBeDisabled();
    expect(screen.getByTestId("add-song-btn")).toBeEnabled();
  });
});
