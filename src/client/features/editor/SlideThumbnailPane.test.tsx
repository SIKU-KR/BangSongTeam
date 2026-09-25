import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PresentationItem } from "#shared";
import { DEFAULT_DECK_STYLE } from "#shared";
import {
  SlideThumbnailPane,
  type SlideThumbnailPaneProps,
} from "./SlideThumbnailPane";

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
    selectedIds: ["s-0-0"],
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
    ...overrides,
  };
  const utils = render(<SlideThumbnailPane {...props} />);
  return { ...utils, props };
}

describe("SlideThumbnailPane (PPT식 썸네일 창)", () => {
  it("세트 전체 슬라이드를 1부터 이어지는 번호로 보여 준다", () => {
    renderPane();

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

  it("썸네일 클릭은 (곡, 곡 안 슬라이드)와 Ctrl/⌘·Shift 여부를 알리고 창에 포커스를 준다", () => {
    const { props } = renderPane();

    fireEvent.click(screen.getByTestId("slide-thumb-4"));
    expect(props.onClickSlide).toHaveBeenCalledWith(2, 0, {
      shift: false,
      mod: false,
    });
    expect(screen.getByTestId("slide-pane-list")).toHaveFocus();

    fireEvent.click(screen.getByTestId("slide-thumb-1"), { metaKey: true });
    expect(props.onClickSlide).toHaveBeenLastCalledWith(0, 1, {
      shift: false,
      mod: true,
    });

    fireEvent.click(screen.getByTestId("slide-thumb-2"), { shiftKey: true });
    expect(props.onClickSlide).toHaveBeenLastCalledWith(0, 2, {
      shift: true,
      mod: false,
    });
  });

  it("곡 머리글을 누르면 그 곡 전체를 선택한다", () => {
    const { props } = renderPane();

    fireEvent.click(screen.getByTestId("song-section-title-1"));
    expect(props.onSelectSong).toHaveBeenCalledWith(1);
  });

  it("선택한 슬라이드를 모두 aria-selected로, 현재 슬라이드를 aria-current로 표시한다", () => {
    renderPane({
      activeSongIndex: 0,
      activeSlideIndex: 2,
      selectedIds: ["s-0-0", "s-0-2"],
    });

    for (const index of [0, 2]) {
      expect(screen.getByTestId(`slide-thumb-${index}`)).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
    expect(screen.getByTestId("slide-thumb-1")).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByTestId("slide-thumb-2")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByTestId("slide-thumb-0")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("썸네일 사이 틈을 누르면 삽입 커서를 두고, 삽입 커서 자리에 가로선을 그린다", () => {
    const { props, rerender } = renderPane();

    fireEvent.click(screen.getByTestId("slide-gap-2-1"));
    expect(props.onSetInsertion).toHaveBeenCalledWith({
      songIndex: 2,
      index: 1,
    });
    expect(screen.getByTestId("slide-gap-2-1")).not.toHaveAttribute(
      "data-active",
    );

    rerender(
      <SlideThumbnailPane
        {...props}
        selectedIds={[]}
        insertion={{ songIndex: 2, index: 1 }}
      />,
    );
    expect(screen.getByTestId("slide-gap-2-1")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("slide-thumb-0")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("hover 복제·삭제 버튼 대신 우클릭 메뉴로 슬라이드를 다룬다", async () => {
    const { props } = renderPane({ canPaste: true });

    expect(screen.queryByTestId(/duplicate-slide-btn/)).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId("slide-thumb-0"));
    const menu = await screen.findByTestId("slide-pane-menu");
    expect(menu).toHaveTextContent("잘라내기");
    expect(props.onClickSlide).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: /슬라이드 복제/ }));
    expect(props.onDuplicateSlides).toHaveBeenCalledTimes(1);
  });

  it("선택 밖의 썸네일을 우클릭하면 그 장만 선택한다", async () => {
    const { props } = renderPane();

    fireEvent.contextMenu(screen.getByTestId("slide-thumb-2"));
    await screen.findByTestId("slide-pane-menu");
    expect(props.onClickSlide).toHaveBeenCalledWith(0, 2, {
      shift: false,
      mod: false,
    });
  });

  it("지울 수 없거나 붙여넣을 것이 없으면 메뉴 항목이 비활성이다", async () => {
    renderPane({ canDelete: false, canPaste: false });

    fireEvent.contextMenu(screen.getByTestId("slide-thumb-0"));
    await screen.findByTestId("slide-pane-menu");
    for (const name of [/잘라내기/, /붙여넣기/, /슬라이드 삭제/]) {
      expect(screen.getByRole("menuitem", { name })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    expect(screen.getByRole("menuitem", { name: /복사/ })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("틈을 우클릭하면 그 자리에 삽입 커서를 두고 붙여넣기·새 슬라이드만 보여 준다", async () => {
    const { props } = renderPane({ canPaste: true });

    fireEvent.contextMenu(screen.getByTestId("slide-gap-0-3"));
    const menu = await screen.findByTestId("slide-pane-menu");
    expect(props.onSetInsertion).toHaveBeenCalledWith({
      songIndex: 0,
      index: 3,
    });
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(menu).not.toHaveTextContent("삭제");

    fireEvent.click(screen.getByRole("menuitem", { name: /붙여넣기/ }));
    expect(props.onPasteSlides).toHaveBeenCalledTimes(1);
  });

  it("곡 머리글 메뉴의 모두 축소·모두 확장은 모든 구역을 접고 편다", async () => {
    renderPane();

    fireEvent.contextMenu(screen.getByTestId("song-section-1"));
    await screen.findByTestId("slide-pane-menu");
    fireEvent.click(screen.getByRole("menuitem", { name: "모두 축소" }));
    await waitFor(() =>
      expect(screen.queryByTestId("slide-thumb-0")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("slide-thumb-5")).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId("song-section-1"));
    await screen.findByTestId("slide-pane-menu");
    fireEvent.click(screen.getByRole("menuitem", { name: "모두 확장" }));
    await waitFor(() =>
      expect(screen.getByTestId("slide-thumb-5")).toBeInTheDocument(),
    );
  });

  it("구역 메뉴는 ⋯ 또는 우클릭으로 열리고, Esc로 닫힌다", async () => {
    renderPane();

    fireEvent.click(screen.getByTestId("song-section-menu-btn-0"));
    expect(screen.getByTestId("song-section-menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "위로 이동" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.keyDown(screen.getByTestId("song-section-menu"), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(screen.queryByTestId("song-section-menu")).not.toBeInTheDocument(),
    );

    fireEvent.contextMenu(screen.getByTestId("song-section-2"));
    await screen.findByTestId("slide-pane-menu");
    expect(
      screen.getByRole("menuitem", { name: "아래로 이동" }),
    ).toHaveAttribute("aria-disabled", "true");
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
    fireEvent.click(
      screen.getByRole("menuitem", { name: "제목·아티스트 수정" }),
    );
    expect(props.onEditSongInfo).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByTestId("song-section-menu-btn-1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "세트에서 제거" }));
    expect(props.onDeleteSong).toHaveBeenCalledWith(1);
  });

  it("곡이 하나뿐이어도 세트에서 제거할 수 있다", () => {
    const { props } = renderPane({ items: makeItems([2]) });

    fireEvent.click(screen.getByTestId("song-section-menu-btn-0"));
    fireEvent.click(screen.getByRole("menuitem", { name: "세트에서 제거" }));
    expect(props.onDeleteSong).toHaveBeenCalledWith(0);
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

  it("넘치지 않는 곡에는 넘침 경고를 띄우지 않는다", () => {
    renderPane();

    expect(screen.queryByTestId(/overflow-warning/)).not.toBeInTheDocument();
  });

  it("박스 폭을 넘는 슬라이드와 화면을 넘치는 곡에 경고 아이콘을 띄운다", () => {
    const [item] = makeItems([2]);
    const overflowing = {
      ...item,
      deck: {
        ...item.deck!,
        style: { ...DEFAULT_DECK_STYLE, fontSizeVw: 10 },
        slides: [
          {
            id: "wrap",
            order: 0,
            lines: ["주의 은혜가 나를 붙드시니 두려움 없이"],
          },
          { id: "tall", order: 1, lines: ["가", "나", "다", "라"] },
        ],
      },
    } as PresentationItem;

    renderPane({ items: [overflowing] });

    expect(screen.getByTestId("song-overflow-warning-0")).toHaveAttribute(
      "aria-label",
      expect.stringContaining(
        "가장 긴 슬라이드(2번)가 화면 가장자리 여백을 넘칩니다",
      ),
    );
    expect(screen.getByTestId("slide-overflow-warning-0")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("자동 줄바꿈"),
    );
    expect(screen.getByTestId("slide-overflow-warning-1")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("화면 가장자리 여백을 넘칩니다"),
    );
  });

  it("곡이 없으면 안내를 보여 주고 새 슬라이드는 비활성이다", () => {
    renderPane({ items: [] });

    expect(screen.getByText(/아직 곡이 없습니다/)).toBeInTheDocument();
    expect(screen.getByTestId("add-slide-btn")).toBeDisabled();
    expect(screen.getByTestId("add-song-btn")).toBeEnabled();
  });
});
