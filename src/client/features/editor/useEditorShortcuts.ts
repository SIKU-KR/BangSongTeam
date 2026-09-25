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

function readContext(): EditorShortcutContext {
  const active = document.activeElement;
  const typing =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable);
  return {
    typing,
    modalOpen: document.querySelector('[role="dialog"]') !== null,
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
