import { useEffect, useRef } from "react";
import {
  resolveEditorShortcut,
  type EditorShortcutAction,
  type EditorShortcutContext,
} from "./editorShortcuts";

/** 동작별 처리기. `false`를 돌려주면 처리하지 않은 것으로 보고 브라우저 기본 동작을 남긴다 */
export type EditorShortcutHandlers = Partial<
  Record<EditorShortcutAction, () => boolean | void>
>;

const MODAL_SELECTOR =
  '[data-slot="dialog-content"], [data-slot="alert-dialog-content"]';

const KEY_HANDLING_WIDGET_SELECTOR =
  '[role="combobox"], [role="listbox"], [role="menu"], [role="slider"], [role="dialog"]';

/** 슬라이드 썸네일 창. 창 자체가 listbox라 위젯 판별보다 먼저 본다 */
const SLIDE_PANE_SELECTOR = "[data-slide-pane]";

function readContext(): EditorShortcutContext {
  const active = document.activeElement;
  const paneFocused =
    active instanceof HTMLElement &&
    active.closest(SLIDE_PANE_SELECTOR) !== null;
  const typing =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement &&
      (active.isContentEditable ||
        (!paneFocused &&
          active.closest(KEY_HANDLING_WIDGET_SELECTOR) !== null)));
  return {
    typing,
    paneFocused,
    modalOpen: document.querySelector(MODAL_SELECTOR) !== null,
    onButton:
      active instanceof HTMLElement &&
      active.closest('button, [role="menuitem"]') !== null,
    canvasFocused:
      !active ||
      active === document.body ||
      (active instanceof HTMLElement &&
        active.closest("[data-editor-canvas]") !== null),
  };
}

/** 편집기 전역 단축키를 window에 건다. 처리기는 매 렌더의 최신 값을 쓴다. */
export function useEditorShortcuts(handlers: EditorShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveEditorShortcut(event, readContext());
      if (!action) return;
      const handler = handlersRef.current[action];
      if (!handler) return;
      if (handler() === false) return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
