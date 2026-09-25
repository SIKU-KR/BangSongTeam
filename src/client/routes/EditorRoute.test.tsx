import React from "react";
import {
  __loadDocumentsForTests,
  SEED_PRESENTATIONS,
} from "../features/presentation";
import { signInAsTestUser } from "../test/sessionFixture";
import { withQueryClient } from "../test/queryClientFixture";
import {
  render,
  screen,
  fireEvent,
  act,
  within,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { EditorRoute } from "./EditorRoute";
import {
  getActivePresentation,
  replaceWithServerDocument,
  resetPresentationStore,
  SEED_PRESENTATION_IDS,
} from "../features/presentation";

const DOC_ID = SEED_PRESENTATION_IDS[0];

function renderEditor(path = `/editor/${DOC_ID}`, state: unknown = null) {
  return render(
    withQueryClient(
      <MemoryRouter
        initialEntries={[state === null ? path : { pathname: path, state }]}
      >
        <Routes>
          <Route path="/editor/:presentationId" element={<EditorRoute />} />
          <Route
            path="/presentations"
            element={<div data-testid="presentations-stub" />}
          />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

const statusBar = () => screen.getByTestId("editor-status-bar");
const stageCanvas = () => screen.getByTestId("editor-stage-canvas");
const firstSong = () => getActivePresentation().items[0].deck!;

async function selectFont(font: string): Promise<void> {
  fireEvent.click(screen.getByRole("combobox", { name: "글꼴" }));
  const option = await screen.findByRole("option", { name: font });
  fireEvent.pointerDown(option);
  fireEvent.mouseDown(option);
  fireEvent.pointerUp(option);
  fireEvent.mouseUp(option);
  fireEvent.click(option);
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "글꼴" })).toHaveTextContent(
      font,
    ),
  );
}

function startLyricsEdit(): HTMLTextAreaElement {
  act(() => {
    fireEvent.keyDown(window, { key: "F2" });
  });
  return lyricsEditor();
}

function lyricsEditor(): HTMLTextAreaElement {
  return screen.getByLabelText("슬라이드 가사 편집") as HTMLTextAreaElement;
}

function typeLyrics(textarea: HTMLTextAreaElement, value: string): void {
  act(() => {
    fireEvent.change(textarea, { target: { value } });
  });
}

function placeCaret(textarea: HTMLTextAreaElement, offset: number): void {
  act(() => {
    textarea.setSelectionRange(offset, offset);
    fireEvent.select(textarea);
  });
}

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("EditorRoute (PowerPoint식 프레젠테이션 편집기)", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    mockNavigate.mockClear();
    vi.restoreAllMocks();
  });

  it("헤더·리본·썸네일 창·캔버스·상태 표시줄을 그리고 오른쪽 패널은 없다", () => {
    renderEditor();

    expect(screen.getByTestId("editor-header")).toBeInTheDocument();
    expect(screen.getByText("2026 주일 3부 예배")).toBeInTheDocument();

    expect(screen.getByTestId("editor-ribbon")).toBeInTheDocument();
    expect(screen.getByTestId("ribbon-song-label")).toHaveTextContent(
      "은혜로다",
    );

    expect(stageCanvas()).toBeInTheDocument();
    expect(statusBar()).toHaveTextContent("슬라이드 1/23");
    expect(statusBar()).toHaveTextContent("곡 1/5");

    expect(screen.getByTestId("slide-thumbnail-pane")).toBeInTheDocument();
    expect(screen.getByTestId("song-section-0")).toHaveTextContent("은혜로다");

    expect(screen.queryByTestId("song-property-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slide-filmstrip")).not.toBeInTheDocument();
  });

  it("should go straight to fullscreen projection when present button is clicked", () => {
    renderEditor();

    const presentBtn = screen.getByTestId("header-present-btn");
    fireEvent.click(presentBtn);

    expect(mockNavigate).toHaveBeenCalledWith(`/present/${DOC_ID}/fullscreen`, {
      state: { returnTo: `/editor/${DOC_ID}` },
    });
  });

  it("should switch active slide when clicking a slide thumbnail", () => {
    renderEditor();

    fireEvent.click(screen.getByTestId("slide-thumb-1"));

    expect(statusBar()).toHaveTextContent("슬라이드 2/23");
    expect(
      within(stageCanvas()).getByText(/주의 사랑을 주의 선하심을/),
    ).toBeInTheDocument();
  });

  it("F2로 슬라이드 위에서 가사를 고치고 Esc로 편집을 끝낸다", () => {
    renderEditor();

    const textarea = startLyricsEdit();
    expect(textarea).toHaveFocus();
    expect(
      within(stageCanvas()).getByTestId("text-layer-box"),
    ).toContainElement(textarea);
    typeLyrics(textarea, "수정된 첫 번째 가사\n수정된 두 번째 가사");

    expect(firstSong().slides[0].lines).toEqual([
      "수정된 첫 번째 가사",
      "수정된 두 번째 가사",
    ]);
    expect(screen.getByTestId("slide-line-count")).toHaveTextContent("2/4줄");

    act(() => {
      fireEvent.keyDown(textarea, { key: "Escape" });
    });
    expect(
      screen.queryByLabelText("슬라이드 가사 편집"),
    ).not.toBeInTheDocument();
    expect(
      within(stageCanvas()).getByText("수정된 두 번째 가사"),
    ).toBeInTheDocument();
  });

  it("캔버스를 더블클릭하면 가사 편집을 시작한다", () => {
    const { container } = renderEditor();

    const canvas = container.querySelector("[data-editor-canvas]")!;
    act(() => {
      fireEvent.doubleClick(canvas);
    });

    expect(lyricsEditor()).toHaveValue(firstSong().slides[0].lines.join("\n"));
  });

  it("커서 위치에서 슬라이드를 나누고 뒷부분 슬라이드를 선택한다", () => {
    renderEditor();
    const textarea = startLyricsEdit();
    typeLyrics(textarea, "첫째 줄\n둘째 줄\n셋째 줄");
    placeCaret(textarea, textarea.value.length);
    const splitBtn = screen.getByTestId("split-slide-btn");
    expect(splitBtn).toBeDisabled();

    placeCaret(textarea, 5);
    expect(splitBtn).toBeEnabled();
    fireEvent.click(splitBtn);

    expect(lyricsEditor().value).toBe("둘째 줄\n셋째 줄");
    expect(lyricsEditor()).toHaveFocus();
    expect(screen.getByTestId("slide-thumb-1")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(firstSong().slides[0].lines).toEqual(["첫째 줄"]);
  });

  it("편집하지 않을 때 나누기는 슬라이드를 가운데에서 나눈다", () => {
    renderEditor();
    const lines = firstSong().slides[0].lines;
    expect(lines.length).toBeGreaterThan(1);

    fireEvent.click(screen.getByTestId("split-slide-btn"));

    const half = Math.ceil(lines.length / 2);
    expect(firstSong().slides[0].lines).toEqual(lines.slice(0, half));
    expect(firstSong().slides[1].lines).toEqual(lines.slice(half));
    expect(statusBar()).toHaveTextContent("슬라이드 2/24");
  });

  it("Ctrl/⌘+Enter로 커서 위치에서 슬라이드를 나눈다", () => {
    renderEditor();
    const textarea = startLyricsEdit();
    typeLyrics(textarea, "가나다\n라마바");

    textarea.setSelectionRange(4, 4);
    act(() => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    });

    expect(lyricsEditor().value).toBe("라마바");
    expect(firstSong().slides[0].lines).toEqual(["가나다"]);
  });

  it("다음 슬라이드와 합치고, 4줄을 넘으면 합치기 버튼을 막는다", () => {
    renderEditor();
    const secondSlideLines = firstSong().slides[1].lines;
    const textarea = startLyricsEdit();
    typeLyrics(textarea, "첫째 줄");

    const mergeBtn = screen.getByTestId("merge-slide-btn");
    expect(mergeBtn).toBeEnabled();
    fireEvent.click(mergeBtn);
    expect(lyricsEditor().value).toBe(
      ["첫째 줄", ...secondSlideLines].join("\n"),
    );

    typeLyrics(lyricsEditor(), "가\n나\n다\n라");
    expect(screen.getByTestId("merge-slide-btn")).toBeDisabled();
  });

  it("한 슬라이드에 4줄을 넘겨 입력하지 않고 나누기 안내를 띄운다", () => {
    renderEditor();
    const textarea = startLyricsEdit();
    typeLyrics(textarea, "가\n나\n다\n라");
    expect(screen.getByTestId("slide-line-count")).toHaveTextContent("4/4줄");

    typeLyrics(textarea, "가\n나\n다\n라\n마");

    expect(textarea.value).toBe("가\n나\n다\n라");
    expect(screen.getByTestId("slide-line-limit-hint")).toBeInTheDocument();
  });

  it("한 줄이 80자를 넘는 입력은 받지 않는다", () => {
    renderEditor();
    const textarea = startLyricsEdit();
    typeLyrics(textarea, "가".repeat(80));
    expect(firstSong().slides[0].lines).toEqual(["가".repeat(80)]);

    typeLyrics(textarea, "가".repeat(81));

    expect(firstSong().slides[0].lines).toEqual(["가".repeat(80)]);
    expect(screen.getByTestId("slide-line-limit-hint")).toBeInTheDocument();
  });

  it("연속으로 입력한 가사는 실행 취소 한 번에 되돌아간다", () => {
    renderEditor();
    const original = firstSong().slides[0].lines;
    const textarea = startLyricsEdit();
    typeLyrics(textarea, "가");
    typeLyrics(textarea, "가나");
    typeLyrics(textarea, "가나다");

    act(() => {
      fireEvent.click(screen.getByTestId("header-undo-btn"));
    });

    expect(firstSong().slides[0].lines).toEqual(original);
  });

  it("편집기에는 암전·가사 숨김 미리보기, 테마 프리셋, 3×3 기준점, 초기화, 공유가 없다", () => {
    renderEditor();

    for (const testId of [
      "test-blackout-btn",
      "test-lyrics-btn",
      "canvas-present-cta",
      "style-preset-0",
      "grid-anchor-bottom-center",
      "song-share-publish-btn",
      "song-share-status",
    ]) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
    expect(screen.queryByText("초기화")).not.toBeInTheDocument();
  });

  it("리본으로 현재 곡의 글꼴·크기·정렬·줄 간격·오버레이를 바꾼다", async () => {
    renderEditor();
    const otherSongStyle = getActivePresentation().items[1].deck!.style;

    await selectFont("Gmarket Sans");
    const size = screen.getByLabelText("글자 크기");
    expect(size).toHaveValue("40");
    fireEvent.change(size, { target: { value: "60" } });
    fireEvent.keyDown(size, { key: "Enter" });
    fireEvent.click(screen.getByTestId("text-align-right-btn"));
    fireEvent.click(screen.getByTestId("line-height-btn"));
    fireEvent.click(screen.getByRole("button", { name: "1.8" }));
    fireEvent.click(screen.getByTestId("overlay-btn"));
    act(() => {
      fireEvent.change(
        screen.getByLabelText("검정 오버레이 불투명도", { selector: "input" }),
        { target: { value: "75" } },
      );
    });

    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByTestId("text-align-right-btn")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(firstSong().style).toMatchObject({
      fontFamily: "Gmarket Sans",
      fontSizeVw: 6.25,
      textAlign: "right",
      lineHeight: 1.8,
      overlayOpacity: 75,
    });
    expect(getActivePresentation().items[1].deck!.style).toEqual(
      otherSongStyle,
    );
  });

  it("글자 크기 키우기·줄이기는 pt 목록을 한 칸씩 움직인다", () => {
    renderEditor();

    fireEvent.click(screen.getByTestId("font-size-up-btn"));
    expect(screen.getByLabelText("글자 크기")).toHaveValue("44");

    fireEvent.click(screen.getByTestId("font-size-down-btn"));
    fireEvent.click(screen.getByTestId("font-size-down-btn"));
    expect(screen.getByLabelText("글자 크기")).toHaveValue("36");
  });

  it("should add a new slide after the current slide", () => {
    renderEditor();

    expect(screen.queryByTestId("slide-thumb-23")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("add-slide-btn"));

    expect(screen.getByTestId("slide-thumb-23")).toBeInTheDocument();
    expect(screen.getByTestId("song-section-0")).toHaveTextContent("6장");
    expect(statusBar()).toHaveTextContent("슬라이드 2/24");
    expect(firstSong().slides[1].lines).toEqual([]);
    expect(lyricsEditor()).toHaveValue("");
    expect(lyricsEditor()).toHaveFocus();
  });

  it("should trigger undo and redo in header", () => {
    renderEditor();

    const undoBtn = screen.getByTestId("header-undo-btn");
    const redoBtn = screen.getByTestId("header-redo-btn");

    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();

    const titleBtn = screen.getByTestId("header-title-btn");
    fireEvent.click(titleBtn);
    const input = screen.getByDisplayValue("2026 주일 3부 예배");
    fireEvent.change(input, { target: { value: "새로운 예배 제목" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("새로운 예배 제목")).toBeInTheDocument();
    expect(undoBtn).not.toBeDisabled();

    fireEvent.click(undoBtn);
    expect(screen.getByText("2026 주일 3부 예배")).toBeInTheDocument();
    expect(redoBtn).not.toBeDisabled();

    fireEvent.click(redoBtn);
    expect(screen.getByText("새로운 예배 제목")).toBeInTheDocument();
  });

  it("should support canvas zoom controls", () => {
    renderEditor();

    expect(screen.getByText("100%")).toBeInTheDocument();

    const zoomInBtn = screen.getByRole("button", { name: "캔버스 확대" });
    fireEvent.click(zoomInBtn);
    expect(screen.getByText("115%")).toBeInTheDocument();

    const zoomOutBtn = screen.getByRole("button", { name: "캔버스 축소" });
    fireEvent.click(zoomOutBtn);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("should support keyboard navigation shortcuts (Space, ArrowRight, ArrowLeft)", () => {
    renderEditor();

    expect(statusBar()).toHaveTextContent("슬라이드 1/23");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(statusBar()).toHaveTextContent("슬라이드 2/23");

    fireEvent.keyDown(window, { key: " " });
    expect(statusBar()).toHaveTextContent("슬라이드 3/23");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(statusBar()).toHaveTextContent("슬라이드 2/23");

    fireEvent.keyDown(window, { key: "End" });
    expect(statusBar()).toHaveTextContent("슬라이드 23/23");

    fireEvent.keyDown(window, { key: "Home" });
    expect(statusBar()).toHaveTextContent("슬라이드 1/23");
  });

  it("Ctrl/⌘+M·D·Delete로 슬라이드를 추가·복제·삭제한다", () => {
    renderEditor();

    act(() => {
      fireEvent.keyDown(window, { key: "d", code: "KeyD", ctrlKey: true });
    });
    expect(screen.getByTestId("song-section-0")).toHaveTextContent("6장");
    expect(statusBar()).toHaveTextContent("슬라이드 2/24");

    act(() => {
      fireEvent.keyDown(window, { key: "Delete" });
    });
    expect(screen.getByTestId("song-section-0")).toHaveTextContent("5장");

    act(() => {
      fireEvent.keyDown(window, { key: "ㅡ", code: "KeyM", metaKey: true });
    });
    expect(screen.getByTestId("song-section-0")).toHaveTextContent("6장");
    expect(lyricsEditor()).toHaveValue("");
  });

  it("Ctrl/⌘+Shift+> 로 글자 크기를 키운다", () => {
    renderEditor();

    act(() => {
      fireEvent.keyDown(window, {
        key: ">",
        code: "Period",
        ctrlKey: true,
        shiftKey: true,
      });
    });

    expect(screen.getByLabelText("글자 크기")).toHaveValue("44");
  });

  it("버튼에 포커스가 있을 때 Space는 슬라이드를 넘기지 않는다", () => {
    renderEditor();

    screen.getByTestId("text-align-left-btn").focus();
    fireEvent.keyDown(window, { key: " " });

    expect(statusBar()).toHaveTextContent("슬라이드 1/23");
  });

  it("글꼴 선택 상자에서 방향키를 눌러도 슬라이드가 넘어가지 않는다", () => {
    renderEditor();

    screen.getByRole("combobox", { name: "글꼴" }).focus();
    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(statusBar()).toHaveTextContent("슬라이드 1/23");
  });

  it("배경 선택 창이 떠 있으면 방향키로 슬라이드를 넘기지 않는다", () => {
    renderEditor();

    fireEvent.click(screen.getByTestId("open-bg-picker-btn"));
    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(statusBar()).toHaveTextContent("슬라이드 1/23");
  });

  it("F5는 슬라이드쇼를 시작한다", () => {
    renderEditor();

    fireEvent.keyDown(window, { key: "F5" });

    expect(mockNavigate).toHaveBeenCalledWith(`/present/${DOC_ID}/fullscreen`, {
      state: { returnTo: `/editor/${DOC_ID}` },
    });
  });

  it("should open file menu and handle actions in EditorHeader", () => {
    renderEditor();

    const fileMenuBtn = screen.getByTestId("header-file-menu-btn");
    fireEvent.click(fileMenuBtn);

    expect(screen.getByText("새 프레젠테이션")).toBeInTheDocument();
    expect(
      screen.queryByText("기본 5곡 세트 불러오기"),
    ).not.toBeInTheDocument();
  });

  it("Ctrl/⌘ 클릭으로 고른 여러 장을 Delete로 한 번에 지우고 Ctrl+Z 한 번에 되돌린다", () => {
    renderEditor();
    const [first, , third, fourth] = firstSong().slides;

    fireEvent.click(screen.getByTestId("slide-thumb-0"));
    fireEvent.click(screen.getByTestId("slide-thumb-2"), { ctrlKey: true });
    expect(statusBar()).toHaveTextContent("슬라이드 3/23");

    act(() => {
      fireEvent.keyDown(window, { key: "Delete" });
    });
    expect(firstSong().slides.map((s) => s.id)).not.toContain(first.id);
    expect(firstSong().slides.map((s) => s.id)).not.toContain(third.id);
    expect(statusBar()).toHaveTextContent("슬라이드 1/21");
    expect(
      within(stageCanvas()).getAllByText(firstSong().slides[0].lines[0]).length,
    ).toBeGreaterThan(0);
    expect(firstSong().slides[1].id).toBe(fourth.id);

    act(() => {
      fireEvent.keyDown(window, { key: "z", code: "KeyZ", ctrlKey: true });
    });
    expect(firstSong().slides).toHaveLength(5);
  });

  it("존재하지 않는 presentationId 는 /presentations 로 리다이렉트된다", () => {
    renderEditor("/editor/999999999999999999999");

    expect(screen.getByTestId("presentations-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-route")).not.toBeInTheDocument();
  });

  it("다른 시드 문서를 id로 직접 열 수 있다", () => {
    renderEditor(`/editor/${SEED_PRESENTATION_IDS[3]}`);

    expect(screen.getByTestId("editor-route")).toBeInTheDocument();
    expect(screen.getByText("수요 성령기도회")).toBeInTheDocument();
  });

  it("?song= 파라미터로 진입하면 해당 곡이 선택된다", () => {
    renderEditor(`/editor/${DOC_ID}?song=2`);

    expect(statusBar()).toHaveTextContent("곡 3/5");
    expect(statusBar()).toHaveTextContent("슬라이드 10/23");
    expect(screen.getAllByText("시선").length).toBeGreaterThan(0);
  });

  it("뒤로가기 버튼은 /presentations 로 이동한다", () => {
    renderEditor();

    fireEvent.click(screen.getByTestId("header-back-btn"));

    expect(mockNavigate).toHaveBeenCalledWith("/presentations");
  });

  it("파일 메뉴의 새 프레젠테이션은 새 문서 URL로 이동한다", () => {
    renderEditor();

    act(() => {
      fireEvent.click(screen.getByTestId("header-file-menu-btn"));
    });
    act(() => {
      fireEvent.click(screen.getByText("새 프레젠테이션"));
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringMatching(/^\/editor\/[A-Za-z0-9_-]{21}$/),
    );
  });

  it("파일 메뉴의 새 가사 입력은 가사 직접 입력 폼을 바로 연다", () => {
    renderEditor();

    act(() => {
      fireEvent.click(screen.getByTestId("header-file-menu-btn"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("header-file-menu-lyric-btn"));
    });

    expect(screen.getByTestId("song-picker-modal")).toBeInTheDocument();
    expect(screen.getByText("새 찬양 가사 직접 입력")).toBeInTheDocument();
    expect(
      screen.getByTestId("song-picker-create-lyrics-input"),
    ).toBeInTheDocument();
  });

  it("썸네일 창의 찬양곡 추가는 곡 목록으로 연다", () => {
    renderEditor();

    act(() => {
      fireEvent.click(screen.getByTestId("add-song-btn"));
    });

    expect(screen.getByTestId("song-picker-modal")).toBeInTheDocument();
    expect(
      screen.queryByTestId("song-picker-create-lyrics-input"),
    ).not.toBeInTheDocument();
  });

  it("파일 메뉴에는 헤더와 중복되는 슬라이드쇼 발표 항목이 없다", () => {
    renderEditor();

    act(() => {
      fireEvent.click(screen.getByTestId("header-file-menu-btn"));
    });

    expect(
      screen.getByTestId("header-file-menu-dropdown"),
    ).not.toHaveTextContent("슬라이드쇼 발표");
  });

  it("파일 메뉴는 ESC 키로 닫힌다", () => {
    renderEditor();

    act(() => {
      fireEvent.click(screen.getByTestId("header-file-menu-btn"));
    });
    expect(screen.getByTestId("header-file-menu-dropdown")).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(
      screen.queryByTestId("header-file-menu-dropdown"),
    ).not.toBeInTheDocument();
  });

  it("파일 메뉴는 바깥 클릭으로 닫힌다", () => {
    renderEditor();

    act(() => {
      fireEvent.click(screen.getByTestId("header-file-menu-btn"));
    });
    expect(screen.getByTestId("header-file-menu-dropdown")).toBeInTheDocument();

    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(
      screen.queryByTestId("header-file-menu-dropdown"),
    ).not.toBeInTheDocument();
  });

  it("파일 메뉴는 버튼을 다시 누르면 닫힌다", () => {
    renderEditor();

    const fileBtn = screen.getByTestId("header-file-menu-btn");
    act(() => {
      fireEvent.click(fileBtn);
    });
    expect(screen.getByTestId("header-file-menu-dropdown")).toBeInTheDocument();

    act(() => {
      fireEvent.click(fileBtn);
    });
    expect(
      screen.queryByTestId("header-file-menu-dropdown"),
    ).not.toBeInTheDocument();
  });

  describe("PPT식 썸네일 창 & 연속 슬라이드 번호", () => {
    it("번호는 곡이 바뀌어도 1로 돌아가지 않고 이어진다", () => {
      renderEditor();

      expect(screen.getByTestId("slide-thumb-4")).toHaveTextContent("5");
      expect(screen.getByTestId("slide-thumb-5")).toHaveTextContent("6");
      expect(screen.getByTestId("slide-thumb-22")).toHaveTextContent("23");

      fireEvent.click(screen.getByTestId("slide-thumb-5"));

      expect(statusBar()).toHaveTextContent("곡 2/5");
      expect(statusBar()).toHaveTextContent("슬라이드 6/23");
      expect(
        within(stageCanvas()).getByText(/주 품에 품으소서/),
      ).toBeInTheDocument();
    });

    it("방향키로 곡 경계를 넘어도 번호가 이어진다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("slide-thumb-4"));
      expect(statusBar()).toHaveTextContent("슬라이드 5/23");

      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(statusBar()).toHaveTextContent("슬라이드 6/23");
      expect(statusBar()).toHaveTextContent("곡 2/5");

      fireEvent.keyDown(window, { key: "ArrowLeft" });
      expect(statusBar()).toHaveTextContent("슬라이드 5/23");
      expect(statusBar()).toHaveTextContent("곡 1/5");
    });

    it("캔버스 이전/다음 버튼은 곡이 아니라 세트의 처음/끝에서만 꺼진다", () => {
      renderEditor();

      expect(screen.getByTestId("canvas-prev-btn")).toBeDisabled();

      fireEvent.click(screen.getByTestId("slide-thumb-4"));
      const nextBtn = screen.getByTestId("canvas-next-btn");
      expect(nextBtn).not.toBeDisabled();
      fireEvent.click(nextBtn);
      expect(statusBar()).toHaveTextContent("슬라이드 6/23");

      fireEvent.click(screen.getByTestId("slide-thumb-22"));
      expect(screen.getByTestId("canvas-next-btn")).toBeDisabled();
    });

    it("구역 헤더를 누르면 그 곡의 첫 슬라이드가 선택된다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("song-section-title-2"));

      expect(statusBar()).toHaveTextContent("슬라이드 10/23");
    });

    it("구역 메뉴로 곡을 아래로 옮기면 선택도 따라간다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("song-section-menu-btn-0"));
      fireEvent.click(screen.getByRole("menuitem", { name: "아래로 이동" }));

      expect(screen.getByTestId("song-section-0")).toHaveTextContent("주 품에");
      expect(screen.getByTestId("song-section-1")).toHaveTextContent(
        "은혜로다",
      );
      expect(statusBar()).toHaveTextContent("곡 2/5");
      expect(statusBar()).toHaveTextContent("슬라이드 5/23");
      expect(screen.queryByTestId("song-section-menu")).not.toBeInTheDocument();
    });

    it("구역 메뉴로 곡을 복제·제거할 수 있다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("song-section-menu-btn-0"));
      fireEvent.click(screen.getByRole("menuitem", { name: "곡 복제" }));

      expect(screen.getByTestId("song-section-1")).toHaveTextContent(
        "은혜로다 (사본)",
      );
      expect(statusBar()).toHaveTextContent("곡 2/6");

      fireEvent.click(screen.getByTestId("song-section-menu-btn-1"));
      fireEvent.click(screen.getByRole("menuitem", { name: "세트에서 제거" }));

      expect(screen.queryByText("은혜로다 (사본)")).not.toBeInTheDocument();
      expect(statusBar()).toHaveTextContent("곡 2/5");
    });

    it("구역 메뉴로 곡 제목·아티스트를 고치고 되돌릴 수 있다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("song-section-menu-btn-0"));
      fireEvent.click(
        screen.getByRole("menuitem", { name: "제목·아티스트 수정" }),
      );

      const titleInput = screen.getByTestId("song-info-title-input");
      expect(titleInput).toHaveValue("은혜로다");

      fireEvent.change(titleInput, { target: { value: "  " } });
      expect(screen.getByTestId("song-info-save-btn")).toBeDisabled();

      fireEvent.change(titleInput, { target: { value: " 은혜 아니면 " } });
      fireEvent.change(screen.getByTestId("song-info-artist-input"), {
        target: { value: "어노인팅" },
      });
      fireEvent.click(screen.getByTestId("song-info-save-btn"));

      expect(screen.queryByTestId("song-info-dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("song-section-title-0")).toHaveTextContent(
        "은혜 아니면",
      );
      expect(screen.getByTestId("song-section-title-0")).toHaveAttribute(
        "aria-label",
        "은혜 아니면 · 어노인팅",
      );

      fireEvent.click(screen.getByTestId("header-undo-btn"));
      expect(screen.getByTestId("song-section-title-0")).toHaveTextContent(
        "은혜로다",
      );
    });

    it("곡 정보 수정 창은 Esc로 닫히고 아무것도 바꾸지 않는다", () => {
      renderEditor();

      fireEvent.contextMenu(screen.getByTestId("song-section-1"));
      fireEvent.click(
        screen.getByRole("menuitem", { name: "제목·아티스트 수정" }),
      );
      fireEvent.change(screen.getByTestId("song-info-title-input"), {
        target: { value: "바뀐 제목" },
      });
      fireEvent.keyDown(document, { key: "Escape" });

      expect(screen.queryByTestId("song-info-dialog")).not.toBeInTheDocument();
      expect(screen.queryByText("바뀐 제목")).not.toBeInTheDocument();
    });

    it("우클릭으로 구역 메뉴가 열리고 Esc로 닫힌다", async () => {
      renderEditor();

      fireEvent.contextMenu(screen.getByTestId("song-section-3"));
      const menu = await screen.findByTestId("slide-pane-menu");
      expect(menu).toHaveTextContent("세트에서 제거");

      fireEvent.keyDown(menu, { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByTestId("slide-pane-menu")).not.toBeInTheDocument(),
      );
    });

    it("구역을 접으면 그 곡의 썸네일만 숨고 번호는 그대로다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("song-section-toggle-1"));

      expect(screen.queryByTestId("slide-thumb-5")).not.toBeInTheDocument();
      expect(screen.getByTestId("slide-thumb-9")).toHaveTextContent("10");

      fireEvent.click(screen.getByTestId("song-section-toggle-1"));
      expect(screen.getByTestId("slide-thumb-5")).toBeInTheDocument();
    });

    it("다른 곡의 슬라이드를 우클릭해 지우면 그 곡으로 선택이 옮겨 간다", async () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("slide-thumb-1"));
      fireEvent.contextMenu(screen.getByTestId("slide-thumb-6"));
      await screen.findByTestId("slide-pane-menu");
      fireEvent.click(screen.getByRole("menuitem", { name: /슬라이드 삭제/ }));

      expect(statusBar()).toHaveTextContent("슬라이드 7/22");
      expect(statusBar()).toHaveTextContent("곡 2/5");
    });

    it("다른 곡을 고르면 리본이 그 곡의 서식을 보여 준다", async () => {
      renderEditor();

      await selectFont("Gmarket Sans");
      fireEvent.click(screen.getByTestId("song-section-title-1"));

      expect(screen.getByTestId("ribbon-song-label")).toHaveTextContent(
        getActivePresentation().items[1].deck!.title,
      );
      expect(screen.getByRole("combobox", { name: "글꼴" })).toHaveTextContent(
        getActivePresentation().items[1].deck!.style.fontFamily,
      );
    });
  });

  describe("빈 편집기 화면", () => {
    const EMPTY_DOC = {
      ...SEED_PRESENTATIONS[0],
      id: "1f00000000000000000ff",
      title: "빈 세트",
      items: [],
    };

    function renderEmptyEditor() {
      resetPresentationStore();
      __loadDocumentsForTests([EMPTY_DOC]);
      return renderEditor(`/editor/${EMPTY_DOC.id}`);
    }

    it("곡이 없으면 안내와 새 곡 추가 버튼을 보여 준다", () => {
      renderEmptyEditor();

      expect(
        screen.getByText("등록된 찬양 곡 또는 슬라이드가 없습니다"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("기본 5곡 세트 불러오기"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText("가사 붙여넣기로 새 곡 추가"),
      ).toBeInTheDocument();
    });

    it("새 곡 추가 버튼은 가사 직접 입력 폼을 바로 연다", () => {
      renderEmptyEditor();

      act(() => {
        fireEvent.click(screen.getByText("가사 붙여넣기로 새 곡 추가"));
      });

      expect(
        screen.getByTestId("song-picker-create-lyrics-input"),
      ).toBeInTheDocument();
    });
  });

  describe("PowerPoint식 슬라이드 창 선택·클립보드", () => {
    const pane = () => screen.getByTestId("slide-pane-list");
    const press = (init: Parameters<typeof fireEvent.keyDown>[1]) =>
      act(() => {
        fireEvent.keyDown(window, init);
      });
    const firstSongIds = () => firstSong().slides.map((s) => s.id);

    it("Shift 클릭으로 범위를 골라 복사하고, 틈을 눌러 그 자리에 붙여넣는다", () => {
      renderEditor();
      const [a, b] = firstSong().slides;

      fireEvent.click(screen.getByTestId("slide-thumb-0"));
      fireEvent.click(screen.getByTestId("slide-thumb-1"), { shiftKey: true });
      expect(pane()).toHaveFocus();
      press({ key: "c", code: "KeyC", ctrlKey: true });

      fireEvent.click(screen.getByTestId("slide-gap-0-5"));
      expect(screen.getByTestId("slide-gap-0-5")).toHaveAttribute(
        "data-active",
        "true",
      );
      press({ key: "v", code: "KeyV", ctrlKey: true });

      const slides = firstSong().slides;
      expect(slides).toHaveLength(7);
      expect(slides[5].lines).toEqual(a.lines);
      expect(slides[6].lines).toEqual(b.lines);
      expect(slides[5].id).not.toBe(a.id);
      expect(statusBar()).toHaveTextContent("슬라이드 7/25");
      expect(screen.getByTestId("slide-thumb-5")).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    it("복사한 곡이 아닌 곡에는 붙여넣지 않는다", async () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("slide-thumb-0"));
      press({ key: "c", code: "KeyC", ctrlKey: true });
      fireEvent.click(screen.getByTestId("slide-thumb-5"));
      press({ key: "v", code: "KeyV", ctrlKey: true });

      expect(statusBar()).toHaveTextContent("슬라이드 6/23");
      fireEvent.contextMenu(screen.getByTestId("slide-thumb-5"));
      expect(
        await screen.findByRole("menuitem", { name: /붙여넣기/ }),
      ).toHaveAttribute("aria-disabled", "true");
    });

    it("잘라내기 후 같은 곡에 붙여넣으면 슬라이드가 옮겨 간다", () => {
      renderEditor();
      const ids = firstSongIds();

      fireEvent.click(screen.getByTestId("slide-thumb-0"));
      press({ key: "x", code: "KeyX", metaKey: true });
      expect(firstSongIds()).toEqual(ids.slice(1));

      fireEvent.click(screen.getByTestId("slide-thumb-3"));
      press({ key: "v", code: "KeyV", metaKey: true });
      expect(firstSong().slides).toHaveLength(5);
      expect(firstSong().slides[4].lines).toEqual(
        SEED_PRESENTATIONS[0].items[0].deck!.slides[0].lines,
      );
    });

    it("Ctrl/⌘+↓·Ctrl/⌘+Shift+↑로 선택을 옮기고 현재 슬라이드가 따라간다", () => {
      renderEditor();
      const ids = firstSongIds();

      fireEvent.click(screen.getByTestId("slide-thumb-1"));
      fireEvent.click(screen.getByTestId("slide-thumb-2"), { shiftKey: true });
      press({ key: "ArrowDown", ctrlKey: true });
      expect(firstSongIds()).toEqual([ids[0], ids[3], ids[1], ids[2], ids[4]]);
      expect(statusBar()).toHaveTextContent("슬라이드 4/23");

      press({ key: "ArrowUp", ctrlKey: true, shiftKey: true });
      expect(firstSongIds()).toEqual([ids[1], ids[2], ids[0], ids[3], ids[4]]);
      expect(statusBar()).toHaveTextContent("슬라이드 2/23");
    });

    it("Shift+↓로 선택을 넓히고, Ctrl/⌘+A로 곡 전체를 고르면 지우지 않는다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("slide-thumb-0"));
      press({ key: "ArrowDown", shiftKey: true });
      expect(screen.getByTestId("slide-thumb-1")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByTestId("slide-thumb-0")).toHaveAttribute(
        "aria-selected",
        "true",
      );

      press({ key: "a", code: "KeyA", ctrlKey: true });
      expect(screen.getByTestId("slide-thumb-4")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      press({ key: "Backspace" });
      expect(firstSong().slides).toHaveLength(5);
    });

    it("삽입 커서에서 Enter를 누르면 그 자리에 새 슬라이드를 넣고 가사 편집을 연다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("slide-gap-0-0"));
      press({ key: "Enter" });

      expect(firstSong().slides).toHaveLength(6);
      expect(firstSong().slides[0].lines).toEqual([]);
      expect(statusBar()).toHaveTextContent("슬라이드 1/24");
      expect(lyricsEditor()).toHaveValue("");
    });

    it("창 밖(캔버스)에서 Enter는 지금처럼 가사 편집을 연다", () => {
      renderEditor();

      press({ key: "Enter" });
      expect(firstSong().slides).toHaveLength(5);
      expect(lyricsEditor()).toBeInTheDocument();
    });
  });

  describe("공유받은 세트", () => {
    const SHARED_ID = "s0000000000000000000a";

    beforeEach(() => {
      replaceWithServerDocument({
        ...SEED_PRESENTATIONS[0],
        id: SHARED_ID,
        userId: "0000000000000000owner",
        access: { ownerName: "인도자", memberId: "0000000000000000user1" },
      });
    });

    it("로그인하고 돌아오면 사본 만들기 창을 바로 연다", async () => {
      renderEditor(`/editor/${SHARED_ID}`, { makeCopy: true });

      expect(
        await screen.findByTestId("copy-picker-dialog"),
      ).toBeInTheDocument();
      expect(mockNavigate).toHaveBeenCalledWith(`/editor/${SHARED_ID}`, {
        replace: true,
        state: null,
      });
    });

    it("그냥 열면 사본 만들기 창을 띄우지 않는다", () => {
      renderEditor(`/editor/${SHARED_ID}`);

      expect(screen.getByTestId("read-only-banner")).toBeInTheDocument();
      expect(
        screen.queryByTestId("copy-picker-dialog"),
      ).not.toBeInTheDocument();
    });
  });
});
