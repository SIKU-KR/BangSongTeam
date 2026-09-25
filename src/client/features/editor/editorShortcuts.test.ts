import { describe, it, expect } from "vitest";
import {
  resolveEditorShortcut,
  type EditorShortcutContext,
  type EditorShortcutKeyEvent,
} from "./editorShortcuts";

const idle: EditorShortcutContext = {
  typing: false,
  modalOpen: false,
  onButton: false,
  canvasFocused: true,
  paneFocused: false,
};

const pane: EditorShortcutContext = {
  ...idle,
  canvasFocused: false,
  paneFocused: true,
};

function key(
  init: Partial<EditorShortcutKeyEvent> & { key: string },
): EditorShortcutKeyEvent {
  return {
    code: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    ...init,
  };
}

describe("resolveEditorShortcut", () => {
  it("Ctrl/⌘ 조합은 글자 대신 code로 판별해 한글 입력 상태에서도 같다", () => {
    expect(
      resolveEditorShortcut(
        key({ key: "ㅋ", code: "KeyZ", metaKey: true }),
        idle,
      ),
    ).toBe("undo");
    expect(
      resolveEditorShortcut(
        key({ key: "Z", code: "KeyZ", ctrlKey: true, shiftKey: true }),
        idle,
      ),
    ).toBe("redo");
    expect(
      resolveEditorShortcut(
        key({ key: "y", code: "KeyY", ctrlKey: true }),
        idle,
      ),
    ).toBe("redo");
    expect(
      resolveEditorShortcut(
        key({ key: "ㅡ", code: "KeyM", ctrlKey: true }),
        idle,
      ),
    ).toBe("newSlide");
    expect(
      resolveEditorShortcut(
        key({ key: "d", code: "KeyD", metaKey: true }),
        idle,
      ),
    ).toBe("duplicateSlide");
    expect(
      resolveEditorShortcut(
        key({ key: ">", code: "Period", ctrlKey: true, shiftKey: true }),
        idle,
      ),
    ).toBe("fontSizeUp");
    expect(
      resolveEditorShortcut(
        key({ key: "<", code: "Comma", ctrlKey: true, shiftKey: true }),
        idle,
      ),
    ).toBe("fontSizeDown");
  });

  it("정렬용 Ctrl+L/E/R은 브라우저에 맡긴다", () => {
    for (const code of ["KeyL", "KeyE", "KeyR"]) {
      expect(
        resolveEditorShortcut(key({ key: "x", code, ctrlKey: true }), idle),
      ).toBeNull();
    }
  });

  it("탐색 키를 슬라이드 이동으로 바꾼다", () => {
    for (const k of ["ArrowLeft", "ArrowUp", "PageUp"]) {
      expect(resolveEditorShortcut(key({ key: k }), idle)).toBe("prevSlide");
    }
    for (const k of ["ArrowRight", "ArrowDown", "PageDown", " "]) {
      expect(resolveEditorShortcut(key({ key: k }), idle)).toBe("nextSlide");
    }
    expect(resolveEditorShortcut(key({ key: "Home" }), idle)).toBe(
      "firstSlide",
    );
    expect(resolveEditorShortcut(key({ key: "End" }), idle)).toBe("lastSlide");
    expect(resolveEditorShortcut(key({ key: "Delete" }), idle)).toBe(
      "deleteSlide",
    );
    expect(resolveEditorShortcut(key({ key: "Backspace" }), idle)).toBeNull();
    expect(resolveEditorShortcut(key({ key: "F5" }), idle)).toBe("present");
  });

  it("입력 중에는 탐색·삭제·복제를 막고 되돌리기·새 슬라이드·글자 크기는 둔다", () => {
    const typing = { ...idle, typing: true, canvasFocused: false };
    for (const k of ["ArrowRight", " ", "Delete", "Home", "F2", "Enter"]) {
      expect(resolveEditorShortcut(key({ key: k }), typing)).toBeNull();
    }
    expect(
      resolveEditorShortcut(
        key({ key: "d", code: "KeyD", ctrlKey: true }),
        typing,
      ),
    ).toBeNull();
    expect(
      resolveEditorShortcut(
        key({ key: "z", code: "KeyZ", ctrlKey: true }),
        typing,
      ),
    ).toBe("undo");
    expect(
      resolveEditorShortcut(
        key({ key: "m", code: "KeyM", ctrlKey: true }),
        typing,
      ),
    ).toBe("newSlide");
    expect(
      resolveEditorShortcut(
        key({ key: ">", code: "Period", ctrlKey: true, shiftKey: true }),
        typing,
      ),
    ).toBe("fontSizeUp");
  });

  it("모달이 떠 있거나 IME 조합 중이면 아무것도 하지 않는다", () => {
    expect(
      resolveEditorShortcut(key({ key: "ArrowRight" }), {
        ...idle,
        modalOpen: true,
      }),
    ).toBeNull();
    expect(
      resolveEditorShortcut(key({ key: "z", code: "KeyZ", ctrlKey: true }), {
        ...idle,
        modalOpen: true,
      }),
    ).toBeNull();
    expect(
      resolveEditorShortcut(key({ key: "Enter", isComposing: true }), idle),
    ).toBeNull();
  });

  it("버튼 위의 Space는 버튼을 누르게 두고, Enter는 캔버스 포커스일 때만 편집을 연다", () => {
    const onButton = { ...idle, onButton: true, canvasFocused: false };
    expect(resolveEditorShortcut(key({ key: " " }), onButton)).toBeNull();
    expect(resolveEditorShortcut(key({ key: "Enter" }), onButton)).toBeNull();
    expect(resolveEditorShortcut(key({ key: "Enter" }), idle)).toBe("editText");
    expect(resolveEditorShortcut(key({ key: "F2" }), onButton)).toBe(
      "editText",
    );
  });

  it("슬라이드 창 포커스에서는 PowerPoint처럼 선택·클립보드·이동 키가 동작한다", () => {
    const cases: Array<
      [Partial<EditorShortcutKeyEvent> & { key: string }, string]
    > = [
      [{ key: "a", code: "KeyA", ctrlKey: true }, "selectAll"],
      [{ key: "c", code: "KeyC", metaKey: true }, "copySlides"],
      [{ key: "ㅌ", code: "KeyX", ctrlKey: true }, "cutSlides"],
      [{ key: "v", code: "KeyV", ctrlKey: true }, "pasteSlides"],
      [{ key: "ArrowUp", ctrlKey: true }, "moveSlidesUp"],
      [{ key: "ArrowDown", metaKey: true }, "moveSlidesDown"],
      [{ key: "ArrowUp", ctrlKey: true, shiftKey: true }, "moveSlidesToStart"],
      [{ key: "ArrowDown", ctrlKey: true, shiftKey: true }, "moveSlidesToEnd"],
      [{ key: "ArrowUp", shiftKey: true }, "extendPrev"],
      [{ key: "ArrowDown", shiftKey: true }, "extendNext"],
      [{ key: "Enter" }, "newSlide"],
      [{ key: "Backspace" }, "deleteSlide"],
      [{ key: "Delete" }, "deleteSlide"],
      [{ key: "Escape" }, "clearInsertion"],
      [{ key: "ArrowDown" }, "nextSlide"],
    ];
    for (const [init, action] of cases) {
      expect(resolveEditorShortcut(key(init), pane)).toBe(action);
    }
  });

  it("창 밖에서는 선택·클립보드 키를 브라우저에 남기고, 창 안 버튼의 Enter는 버튼을 누른다", () => {
    for (const code of ["KeyA", "KeyC", "KeyX", "KeyV"]) {
      expect(
        resolveEditorShortcut(key({ key: "", code, ctrlKey: true }), idle),
      ).toBeNull();
    }
    expect(
      resolveEditorShortcut(key({ key: "ArrowUp", ctrlKey: true }), idle),
    ).toBeNull();
    expect(resolveEditorShortcut(key({ key: "Backspace" }), idle)).toBeNull();
    expect(
      resolveEditorShortcut(key({ key: "Enter" }), { ...pane, onButton: true }),
    ).toBeNull();
  });
});
