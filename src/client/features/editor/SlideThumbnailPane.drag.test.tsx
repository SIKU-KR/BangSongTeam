import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { DndContextProps, DragStartEvent } from "@dnd-kit/core";
import type { PresentationItem } from "#shared";
import { DEFAULT_DECK_STYLE } from "#shared";
import {
  SlideThumbnailPane,
  type SlideThumbnailPaneProps,
} from "./SlideThumbnailPane";
import { SlideListSheet } from "./SlideListSheet";
import { useCollapsedSongs } from "./useCollapsedSongs";
import { EDITOR_COPY } from "#copy/editor";

const dnd = vi.hoisted(() => ({ started: [] as string[] }));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    DndContext: (props: DndContextProps) =>
      createElement(actual.DndContext, {
        ...props,
        onDragStart: (event: DragStartEvent) => {
          dnd.started.push(String(event.active.id));
          props.onDragStart?.(event);
        },
      }),
  };
});

vi.mock("../../components/stage/SlideStage", () => ({
  SlideStage: () => null,
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

type PaneProps = Omit<SlideThumbnailPaneProps, "collapsedSongs">;

function TestPane(props: PaneProps): React.JSX.Element {
  const collapsedSongs = useCollapsedSongs(
    props.items[props.activeSongIndex]?.id,
  );
  return <SlideThumbnailPane {...props} collapsedSongs={collapsedSongs} />;
}

function paneProps(overrides: Partial<PaneProps> = {}): PaneProps {
  return {
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
}

function renderPane(overrides: Partial<PaneProps> = {}): PaneProps {
  const props = paneProps(overrides);
  render(<TestPane {...props} />);
  return props;
}

const THUMB = "slide-thumb-1";
const THUMB_DRAG_ID = "slide:item-0:s-0-1";
const HEADER = "song-section-1";
const HEADER_DRAG_ID = "song-header:item-1";

const fingerAt = (clientY: number) => ({
  touches: [{ clientX: 100, clientY }],
});

const touchPointer = (clientY: number) => ({
  pointerType: "touch",
  isPrimary: true,
  button: 0,
  clientX: 100,
  clientY,
});

function touchDown(target: Element, clientY = 100): void {
  fireEvent.pointerDown(target, touchPointer(clientY));
  fireEvent.touchStart(target, fingerAt(clientY));
}

function touchTo(target: Element, clientY: number): void {
  fireEvent.pointerMove(target, touchPointer(clientY));
  fireEvent.touchMove(target, fingerAt(clientY));
}

function touchUp(target: Element, clientY = 100): void {
  fireEvent.pointerUp(target, touchPointer(clientY));
  fireEvent.touchEnd(target);
}

function elapse(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function holdAndMove(target: Element): void {
  touchDown(target);
  elapse(300);
  touchTo(target, 112);
  elapse(800);
  touchUp(target, 112);
}

function swipe(target: Element): void {
  touchDown(target);
  elapse(50);
  touchTo(target, 112);
  elapse(800);
  touchUp(target, 112);
}

function tap(target: Element, heldMs: number): void {
  touchDown(target);
  elapse(heldMs);
  touchUp(target);
  fireEvent.mouseDown(target, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.mouseUp(target, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.click(target);
}

function longPress(target: Element): void {
  touchDown(target);
  elapse(600);
  touchUp(target);
}

function mouseDrag(target: Element, travel: number): void {
  fireEvent.mouseDown(target, { button: 0, clientX: 40, clientY: 40 });
  fireEvent.mouseMove(target, { clientX: 40, clientY: 40 + travel });
  fireEvent.mouseUp(target);
}

const menu = (): HTMLElement | null => screen.queryByTestId("slide-pane-menu");

describe("SlideThumbnailPane 터치 끌기", () => {
  beforeEach(() => {
    dnd.started.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (!vi.isFakeTimers()) return;
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it("슬라이드 위에서 쓸어 스크롤해도 끌기가 시작되지 않고 그 슬라이드가 선택되지도 않는다", () => {
    const props = renderPane();
    vi.useFakeTimers();

    swipe(screen.getByTestId(THUMB));

    expect(dnd.started).toEqual([]);
    expect(props.onClickSlide).not.toHaveBeenCalled();
    expect(menu()).not.toBeInTheDocument();
  });

  it("곡 머리글 위에서 쓸어도 곡 끌기가 시작되지 않는다", () => {
    renderPane();
    vi.useFakeTimers();

    swipe(screen.getByTestId(HEADER));

    expect(dnd.started).toEqual([]);
  });

  it("꾹 누른 채 움직이면 그 슬라이드의 끌기를 시작하고, 길게 누르기 메뉴는 열리지 않는다", () => {
    const props = renderPane();
    vi.useFakeTimers();

    holdAndMove(screen.getByTestId(THUMB));

    expect(dnd.started).toEqual([THUMB_DRAG_ID]);
    expect(props.onClickSlide).toHaveBeenCalledExactlyOnceWith(0, 1, {
      shift: false,
      mod: false,
    });
    expect(menu()).not.toBeInTheDocument();
  });

  it("이미 선택한 슬라이드를 꾹 눌러 끌면 선택을 바꾸지 않는다", () => {
    const props = renderPane({
      selectedIds: ["s-0-1"],
      activeSlideIndex: 1,
    });
    vi.useFakeTimers();

    holdAndMove(screen.getByTestId(THUMB));

    expect(dnd.started).toEqual([THUMB_DRAG_ID]);
    expect(props.onClickSlide).not.toHaveBeenCalled();
  });

  it("꾹 누른 채 곡 머리글을 움직이면 곡 끌기를 시작한다", () => {
    renderPane();
    vi.useFakeTimers();

    holdAndMove(screen.getByTestId(HEADER));

    expect(dnd.started).toEqual([HEADER_DRAG_ID]);
  });

  it("우클릭 이벤트 없이 슬라이드를 꾹 누르면 끌기 없이 그 슬라이드의 메뉴를 열고 그 슬라이드를 고른다", () => {
    const props = renderPane();
    vi.useFakeTimers();

    longPress(screen.getByTestId(THUMB));

    expect(menu()).toHaveTextContent(EDITOR_COPY.thumbnails.cut);
    expect(screen.getAllByRole("menuitem")).toHaveLength(6);
    expect(props.onClickSlide).toHaveBeenCalledExactlyOnceWith(0, 1, {
      shift: false,
      mod: false,
    });
    expect(dnd.started).toEqual([]);
  });

  it("이미 선택한 슬라이드를 꾹 누르면 선택을 그대로 두고 메뉴를 연다", () => {
    const props = renderPane({ selectedIds: ["s-0-1"], activeSlideIndex: 1 });
    vi.useFakeTimers();

    longPress(screen.getByTestId(THUMB));

    expect(menu()).toHaveTextContent(EDITOR_COPY.thumbnails.cut);
    expect(props.onClickSlide).not.toHaveBeenCalled();
  });

  it("우클릭 이벤트 없이 곡 머리글을 꾹 누르면 그 곡의 메뉴를 연다", () => {
    const props = renderPane();
    vi.useFakeTimers();

    longPress(screen.getByTestId(HEADER));

    expect(menu()).toHaveTextContent(EDITOR_COPY.song.removeFromSet);
    expect(menu()).not.toHaveTextContent(EDITOR_COPY.thumbnails.cut);
    fireEvent.click(
      screen.getByRole("menuitem", { name: EDITOR_COPY.song.moveUp }),
    );
    expect(props.onReorderSong).toHaveBeenCalledWith(1, 0);
  });

  it("우클릭 이벤트 없이 틈을 꾹 누르면 그 자리에 삽입 커서를 두고 붙여넣기·새 슬라이드 메뉴를 연다", () => {
    const props = renderPane({ canPaste: true });
    vi.useFakeTimers();

    longPress(screen.getByTestId("slide-gap-0-3"));

    expect(props.onSetInsertion).toHaveBeenCalledWith({
      songIndex: 0,
      index: 3,
    });
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(menu()).toHaveTextContent(EDITOR_COPY.thumbnails.paste);
  });

  it("목록의 빈 곳을 꾹 누르면 맨 끝 자리에 삽입 커서를 두고 메뉴를 연다", () => {
    const props = renderPane();
    vi.useFakeTimers();

    longPress(screen.getByTestId("slide-pane-list"));

    expect(props.onSetInsertion).toHaveBeenCalledWith({
      songIndex: 2,
      index: 2,
    });
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("앞서 연 메뉴가 아니라 지금 누른 곳의 메뉴를 연다", async () => {
    renderPane();
    fireEvent.contextMenu(screen.getByTestId(THUMB));
    await screen.findByTestId("slide-pane-menu");
    fireEvent.keyDown(screen.getByTestId("slide-pane-menu"), {
      key: "Escape",
    });
    await waitFor(() => expect(menu()).not.toBeInTheDocument());
    vi.useFakeTimers();

    longPress(screen.getByTestId(HEADER));

    expect(menu()).toHaveTextContent(EDITOR_COPY.song.removeFromSet);
    expect(menu()).not.toHaveTextContent(EDITOR_COPY.thumbnails.cut);
  });

  it("곡 ⋯ 메뉴의 항목을 꾹 눌러도 슬라이드 메뉴가 겹쳐 열리지 않는다", () => {
    renderPane();
    fireEvent.click(screen.getByTestId("song-section-menu-btn-0"));
    const item = screen.getByRole("menuitem", {
      name: EDITOR_COPY.song.editInfo,
    });
    vi.useFakeTimers();

    longPress(item);

    expect(menu()).not.toBeInTheDocument();
  });

  it("보기 전용이면 슬라이드든 곡 머리글이든 꾹 눌러도 메뉴가 열리지 않는다", () => {
    renderPane({ readOnly: true });
    vi.useFakeTimers();

    longPress(screen.getByTestId(THUMB));
    longPress(screen.getByTestId(HEADER));

    expect(menu()).not.toBeInTheDocument();
  });

  it("곡이 없으면 빈 곳을 꾹 눌러도 메뉴가 열리지 않는다", () => {
    renderPane({ items: [] });
    vi.useFakeTimers();

    longPress(screen.getByTestId("slide-pane-list"));

    expect(menu()).not.toBeInTheDocument();
  });

  it("꾹 눌러 브라우저가 우클릭 이벤트를 보내면 그 슬라이드의 메뉴를 열고 그 슬라이드를 고른다", () => {
    const props = renderPane();
    vi.useFakeTimers();
    const thumb = screen.getByTestId(THUMB);

    touchDown(thumb);
    elapse(450);
    fireEvent.contextMenu(thumb);
    elapse(100);
    touchUp(thumb);

    expect(menu()).toHaveTextContent(EDITOR_COPY.thumbnails.cut);
    expect(props.onClickSlide).toHaveBeenCalledExactlyOnceWith(0, 1, {
      shift: false,
      mod: false,
    });
    expect(dnd.started).toEqual([]);
  });

  it("우클릭 이벤트와 길게 누르기 타이머가 둘 다 메뉴를 열어도 열린 메뉴에서 창으로 포커스를 다시 옮기지 않는다", () => {
    renderPane();
    vi.useFakeTimers();
    const thumb = screen.getByTestId(THUMB);
    const pane = screen.getByTestId("slide-pane-list");
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    touchDown(thumb);
    elapse(450);
    fireEvent.contextMenu(thumb);
    elapse(100);
    touchUp(thumb);

    expect(menu()).toBeInTheDocument();
    expect(focus.mock.contexts.filter((element) => element === pane)).toEqual([
      pane,
    ]);
  });

  it("메뉴가 열린 뒤 손가락을 움직이면 메뉴를 닫고 그 슬라이드의 끌기를 시작한다", () => {
    renderPane();
    vi.useFakeTimers();
    const thumb = screen.getByTestId(THUMB);

    touchDown(thumb);
    elapse(600);
    expect(menu()).toBeInTheDocument();
    touchTo(thumb, 160);
    elapse(500);
    touchUp(thumb, 160);

    expect(dnd.started).toEqual([THUMB_DRAG_ID]);
    expect(menu()).not.toBeInTheDocument();
  });

  it("탭하면 끌기 없이 그 슬라이드를 고른다", () => {
    const props = renderPane();
    vi.useFakeTimers();

    tap(screen.getByTestId(THUMB), 80);

    expect(dnd.started).toEqual([]);
    expect(props.onClickSlide).toHaveBeenCalledExactlyOnceWith(0, 1, {
      shift: false,
      mod: false,
    });
    expect(menu()).not.toBeInTheDocument();
  });

  it("느리게 눌렀다 떼도 끌기를 시작하지 않고, 이어지는 클릭으로 슬라이드를 고른다", () => {
    const props = renderPane();
    vi.useFakeTimers();

    tap(screen.getByTestId(THUMB), 400);

    expect(dnd.started).toEqual([]);
    expect(props.onClickSlide).toHaveBeenCalledExactlyOnceWith(0, 1, {
      shift: false,
      mod: false,
    });
  });

  it("보기 전용이면 꾹 눌러 움직여도 끌지 않는다", () => {
    renderPane({ readOnly: true });
    vi.useFakeTimers();

    holdAndMove(screen.getByTestId(THUMB));
    holdAndMove(screen.getByTestId(HEADER));

    expect(dnd.started).toEqual([]);
  });

  it("폰 폭 시트에서는 꾹 눌러 움직이거나 쓸어도 터치로 끌지 않는다", () => {
    const props = paneProps({ variant: "sheet" });
    render(
      <SlideListSheet open onOpenChange={vi.fn()}>
        <TestPane {...props} />
      </SlideListSheet>,
    );
    vi.useFakeTimers();

    holdAndMove(screen.getByTestId(THUMB));
    swipe(screen.getByTestId(THUMB));

    expect(dnd.started).toEqual([]);
  });
});

describe("SlideThumbnailPane 마우스 끌기", () => {
  beforeEach(() => {
    dnd.started.length = 0;
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  it("5px 넘게 움직이면 그 슬라이드의 끌기를 시작하고 그 슬라이드를 고른다", () => {
    const props = renderPane();

    mouseDrag(screen.getByTestId(THUMB), 6);

    expect(dnd.started).toEqual([THUMB_DRAG_ID]);
    expect(props.onClickSlide).toHaveBeenCalledExactlyOnceWith(0, 1, {
      shift: false,
      mod: false,
    });
  });

  it("5px 이하만 움직이면 끌기를 시작하지 않는다", () => {
    renderPane();

    mouseDrag(screen.getByTestId(THUMB), 4);

    expect(dnd.started).toEqual([]);
  });

  it("5px 넘게 움직이면 곡 머리글의 곡 끌기를 시작한다", () => {
    renderPane();

    mouseDrag(screen.getByTestId(HEADER), 6);

    expect(dnd.started).toEqual([HEADER_DRAG_ID]);
  });

  it("우클릭하면 끌기 없이 그 슬라이드의 메뉴를 연다", () => {
    renderPane();
    const thumb = screen.getByTestId(THUMB);

    fireEvent.mouseDown(thumb, { button: 2, clientX: 40, clientY: 40 });
    fireEvent.contextMenu(thumb);
    fireEvent.mouseUp(thumb, { button: 2 });

    expect(menu()).toHaveTextContent(EDITOR_COPY.thumbnails.cut);
    expect(dnd.started).toEqual([]);
  });

  it("끄는 중에 우클릭해도 메뉴를 열지 않는다", () => {
    renderPane();
    const thumb = screen.getByTestId(THUMB);

    fireEvent.mouseDown(thumb, { button: 0, clientX: 40, clientY: 40 });
    fireEvent.mouseMove(thumb, { clientX: 40, clientY: 60 });
    expect(dnd.started).toEqual([THUMB_DRAG_ID]);
    fireEvent.contextMenu(screen.getByTestId(HEADER));
    fireEvent.mouseUp(thumb);

    expect(menu()).not.toBeInTheDocument();
  });

  it("보기 전용이면 마우스로도 끌지 않는다", () => {
    renderPane({ readOnly: true });

    mouseDrag(screen.getByTestId(THUMB), 6);

    expect(dnd.started).toEqual([]);
  });

  it("폰 폭 시트에서도 마우스로는 끈다", () => {
    const props = paneProps({ variant: "sheet" });
    render(
      <SlideListSheet open onOpenChange={vi.fn()}>
        <TestPane {...props} />
      </SlideListSheet>,
    );

    mouseDrag(screen.getByTestId(THUMB), 6);

    expect(dnd.started).toEqual([THUMB_DRAG_ID]);
  });
});
