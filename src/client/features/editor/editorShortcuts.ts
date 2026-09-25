/** 편집기 단축키가 실행하는 동작 */
export type EditorShortcutAction =
  | "undo"
  | "redo"
  | "prevSlide"
  | "nextSlide"
  | "firstSlide"
  | "lastSlide"
  | "editText"
  | "newSlide"
  | "duplicateSlide"
  | "deleteSlide"
  | "fontSizeUp"
  | "fontSizeDown"
  | "present"
  | "selectAll"
  | "copySlides"
  | "cutSlides"
  | "pasteSlides"
  | "extendPrev"
  | "extendNext"
  | "moveSlidesUp"
  | "moveSlidesDown"
  | "moveSlidesToStart"
  | "moveSlidesToEnd"
  | "clearInsertion";

/** 키가 눌린 순간의 포커스 상황 */
export interface EditorShortcutContext {
  /** 입력칸이나 방향키를 스스로 쓰는 위젯(콤보박스·메뉴·슬라이더·팝오버)에 포커스가 있다 */
  typing: boolean;
  /** 모달 대화 상자(Dialog·AlertDialog)가 떠 있다. 리본 팝오버는 모달이 아니다 */
  modalOpen: boolean;
  /** 버튼·메뉴 항목에 포커스가 있다 (Space가 그 버튼을 누른다) */
  onButton: boolean;
  /** 포커스가 body나 편집 캔버스에 있다 (Enter로 편집을 시작해도 된다) */
  canvasFocused: boolean;
  /** 포커스가 슬라이드 썸네일 창에 있다 (선택·클립보드·이동 단축키가 동작한다) */
  paneFocused: boolean;
}

export type EditorShortcutKeyEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing"
>;

/**
 * 키 입력을 편집기 동작으로 바꾼다. 글자 키는 한글 입력 상태에서도 같도록
 * `code`로 본다. Ctrl+L/E/R(정렬)은 Chrome의 주소창·새로고침과 겹쳐 두지 않는다.
 * 선택·클립보드·이동 키는 PowerPoint처럼 슬라이드 창에 포커스가 있을 때만 쓴다.
 */
export function resolveEditorShortcut(
  event: EditorShortcutKeyEvent,
  context: EditorShortcutContext,
): EditorShortcutAction | null {
  if (event.isComposing || context.modalOpen) return null;

  const mod = event.ctrlKey || event.metaKey;
  if (mod && !event.altKey) {
    if (event.code === "KeyZ") return event.shiftKey ? "redo" : "undo";
    if (event.code === "KeyY" && !event.shiftKey) return "redo";
    if (event.code === "KeyM" && !event.shiftKey) return "newSlide";
    if (event.shiftKey && event.code === "Period") return "fontSizeUp";
    if (event.shiftKey && event.code === "Comma") return "fontSizeDown";
    if (event.code === "KeyD" && !event.shiftKey && !context.typing) {
      return "duplicateSlide";
    }
    if (!context.paneFocused || context.typing) return null;
    if (event.key === "ArrowUp") {
      return event.shiftKey ? "moveSlidesToStart" : "moveSlidesUp";
    }
    if (event.key === "ArrowDown") {
      return event.shiftKey ? "moveSlidesToEnd" : "moveSlidesDown";
    }
    if (event.shiftKey) return null;
    if (event.code === "KeyA") return "selectAll";
    if (event.code === "KeyC") return "copySlides";
    if (event.code === "KeyX") return "cutSlides";
    if (event.code === "KeyV") return "pasteSlides";
    return null;
  }
  if (mod || event.altKey) return null;

  if (event.key === "F5") return "present";
  if (context.typing) return null;

  if (context.paneFocused) {
    if (event.shiftKey && event.key === "ArrowUp") return "extendPrev";
    if (event.shiftKey && event.key === "ArrowDown") return "extendNext";
    if (event.key === "Enter") return context.onButton ? null : "newSlide";
    if (event.key === "Backspace") return "deleteSlide";
    if (event.key === "Escape") return "clearInsertion";
  }

  switch (event.key) {
    case "F2":
      return "editText";
    case "Enter":
      return context.canvasFocused ? "editText" : null;
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
      return "prevSlide";
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
      return "nextSlide";
    case " ":
      return context.onButton ? null : "nextSlide";
    case "Home":
      return "firstSlide";
    case "End":
      return "lastSlide";
    case "Delete":
      return "deleteSlide";
    default:
      return null;
  }
}

/** 단축키 안내 팝오버에 보여 줄 편집기 단축키 표 */
export const EDITOR_SHORTCUT_GUIDE: ReadonlyArray<{
  keys: string;
  action: string;
}> = [
  { keys: "Ctrl/⌘+Z · Ctrl/⌘+Shift+Z", action: "실행 취소 · 다시 실행" },
  { keys: "← → / PageUp · PageDown / Space", action: "이전·다음 슬라이드" },
  { keys: "Home / End", action: "세트 처음·마지막 슬라이드" },
  { keys: "더블클릭 / Enter / F2", action: "슬라이드에서 가사 직접 편집" },
  { keys: "Ctrl/⌘+Enter", action: "편집 중 커서 위치에서 슬라이드 나누기" },
  { keys: "Esc", action: "가사 편집 끝내기" },
  { keys: "Ctrl/⌘+M", action: "새 슬라이드" },
  { keys: "Ctrl/⌘+D", action: "슬라이드 복제" },
  { keys: "Delete", action: "슬라이드 삭제" },
  { keys: "Ctrl/⌘·Shift+클릭", action: "슬라이드 창에서 여러 장 선택" },
  {
    keys: "Shift+↑ ↓ / Ctrl/⌘+A",
    action: "슬라이드 창에서 선택 넓히기 · 곡 전체",
  },
  {
    keys: "Ctrl/⌘+C · X · V",
    action: "슬라이드 창에서 복사 · 잘라내기 · 붙여넣기",
  },
  {
    keys: "Ctrl/⌘+↑ ↓ (+Shift)",
    action: "슬라이드 한 칸 위·아래로 (곡 처음·끝으로)",
  },
  { keys: "Enter / Backspace", action: "슬라이드 창에서 새 슬라이드 · 삭제" },
  { keys: "Ctrl/⌘+Shift+> / <", action: "글자 크기 키우기·줄이기" },
  { keys: "F5", action: "슬라이드쇼 발표" },
];
