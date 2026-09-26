import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { PresentationItem } from "#shared";
import { DEFAULT_DECK_STYLE } from "#shared";
import type { SlideStageProps } from "../../components/stage/SlideStage";
import {
  SlideThumbnailPane,
  type SlideThumbnailPaneProps,
} from "./SlideThumbnailPane";

const stageRenders = vi.hoisted(() => [] as string[]);

vi.mock("../../components/stage/SlideStage", () => ({
  SlideStage: ({ slide }: SlideStageProps) => {
    stageRenders.push(slide?.id ?? "");
    return null;
  },
}));

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

function withEditedLine(
  items: PresentationItem[],
  songIndex: number,
  slideIndex: number,
  line: string,
): PresentationItem[] {
  return items.map((item, index) => {
    if (index !== songIndex || !item.deck) return item;
    const slides = item.deck.slides.map((slide, i) =>
      i === slideIndex ? { ...slide, lines: [line] } : slide,
    );
    return { ...item, deck: { ...item.deck, slides } };
  });
}

function paneProps(items: PresentationItem[]): SlideThumbnailPaneProps {
  return {
    items,
    activeSongIndex: 1,
    activeSlideIndex: 2,
    selectedIds: ["s-1-2"],
    insertion: null,
    canDelete: true,
    canPaste: false,
    onClickSlide: vi.fn(),
    onSelectSong: vi.fn(),
    onSetInsertion: vi.fn(),
    onAddSlide: vi.fn(),
    onDuplicateSlides: vi.fn(),
    onDeleteSlides: vi.fn(),
    onCopySlides: vi.fn(),
    onCutSlides: vi.fn(),
    onPasteSlides: vi.fn(),
    onDropSlides: vi.fn(),
    onReorderSong: vi.fn(),
    onDuplicateSong: vi.fn(),
    onEditSongInfo: vi.fn(),
    onDeleteSong: vi.fn(),
    onOpenSongPicker: vi.fn(),
  };
}

describe("SlideThumbnailPane 다시 그리기", () => {
  beforeEach(() => {
    stageRenders.length = 0;
  });

  it("가사를 한 글자 고치면 바뀐 슬라이드의 썸네일만 다시 그린다", () => {
    const items = makeItems([10, 10, 10]);
    const { rerender } = render(<SlideThumbnailPane {...paneProps(items)} />);
    expect(stageRenders).toHaveLength(30);

    stageRenders.length = 0;
    rerender(
      <SlideThumbnailPane
        {...paneProps(withEditedLine(items, 1, 2, "곡2 슬라이드3!"))}
      />,
    );

    expect(stageRenders).toEqual(["s-1-2"]);
  });

  it("보기 전용 세트도 부모가 다시 그려질 때 썸네일을 다시 그리지 않는다", () => {
    const items = makeItems([5, 5]);
    const { rerender } = render(
      <SlideThumbnailPane {...paneProps(items)} readOnly />,
    );

    stageRenders.length = 0;
    rerender(<SlideThumbnailPane {...paneProps(items)} readOnly />);

    expect(stageRenders).toEqual([]);
  });
});
