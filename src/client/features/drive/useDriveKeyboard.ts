import { useEffect, useRef } from "react";
import type { DriveContextValue } from "./driveContext";
import type { DriveItem, DriveItemRef } from "./driveModel";
import {
  isControlTarget,
  isLetterKey,
  isMenuTarget,
  isTypingTarget,
} from "./keyboard";
import { rangeKeys, stepFocus, toggleKey } from "./selectionModel";

export interface DriveKeyboardOptions {
  drive: DriveContextValue;
  items: readonly DriveItem[];
  isTrash: boolean;
  /** 메뉴·대화 상자·끌기 중에는 끈다 */
  enabled: boolean;
  open: (item: DriveItem) => void;
  focusRow: (key: string) => void;
}

const STEP: Record<string, number> = {
  ArrowDown: 1,
  ArrowUp: -1,
  Home: -Infinity,
  End: Infinity,
};

function toRef(item: DriveItem): DriveItemRef {
  return { kind: item.kind, id: item.id };
}

/**
 * 드라이브 목록의 키보드 조작 (구글 드라이브와 같다).
 *
 * - ↑↓·Home·End: 포커스 이동과 단일 선택 · Shift: 범위 확장 · Ctrl/⌘: 포커스만 이동
 * - Space: 포커스 항목 토글 · Enter: 열기 · F2: 이름 바꾸기 · Delete: 휴지통
 * - Esc: 선택 해제 · Ctrl/⌘+A: 모두 선택 · Z: 이동 · Shift+F: 새 폴더 · Shift+P: 새 프레젠테이션
 * - Shift+F10·메뉴 키: 브라우저가 포커스 행에 contextmenu를 보내 우클릭 메뉴가 뜬다
 *
 * 글자 단축키는 한글 입력 상태에서도 동작한다 (`isLetterKey`).
 */
export function useDriveKeyboard(options: DriveKeyboardOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      const { drive, items, isTrash, enabled, open, focusRow } =
        optionsRef.current;
      if (
        !enabled ||
        event.isComposing ||
        isTypingTarget(event.target) ||
        isMenuTarget(event.target)
      ) {
        return;
      }
      const keys = items.map((item) => item.key);
      const selected = items.filter((item) => drive.selection.has(item.key));
      const focus =
        drive.focusKey !== null && keys.includes(drive.focusKey)
          ? drive.focusKey
          : null;
      const mod = event.metaKey || event.ctrlKey;
      const plain = !mod && !event.altKey && !event.shiftKey;

      if (event.key in STEP && !event.altKey) {
        const next = stepFocus(keys, focus, STEP[event.key]);
        if (next === null) return;
        event.preventDefault();
        if (event.shiftKey) {
          const anchor =
            drive.anchorKey !== null && keys.includes(drive.anchorKey)
              ? drive.anchorKey
              : (focus ?? next);
          drive.setSelection(rangeKeys(keys, anchor, next), anchor);
          drive.setFocusKey(next);
        } else if (mod) {
          drive.setFocusKey(next);
        } else {
          drive.setSelection([next], next);
        }
        focusRow(next);
        return;
      }

      if (event.key === " " && plain) {
        if (isControlTarget(event.target) || focus === null) return;
        event.preventDefault();
        drive.setSelection(toggleKey(drive.selection, focus), focus);
        return;
      }

      if (event.key === "Escape") {
        drive.clearSelection();
      } else if (mod && !event.altKey && isLetterKey(event, "a")) {
        event.preventDefault();
        drive.setSelection(keys, keys[0] ?? null);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (selected.length === 0) return;
        event.preventDefault();
        if (isTrash) drive.requestDeleteForever(selected.map(toRef));
        else drive.trash(selected.map(toRef));
      } else if (event.key === "Enter" && !mod) {
        if (isControlTarget(event.target) || selected.length !== 1) return;
        event.preventDefault();
        open(selected[0]);
      } else if (event.key === "F2" && selected.length === 1 && !isTrash) {
        event.preventDefault();
        drive.requestRename(toRef(selected[0]));
      } else if (plain && isLetterKey(event, "z") && !isTrash) {
        if (selected.length === 0) return;
        event.preventDefault();
        drive.requestMove(selected.map(toRef));
      } else if (
        event.shiftKey &&
        !mod &&
        !event.altKey &&
        !isTrash &&
        (isLetterKey(event, "f") || isLetterKey(event, "p"))
      ) {
        event.preventDefault();
        if (isLetterKey(event, "f")) {
          drive.requestNewFolder(drive.currentFolderId);
        } else drive.createPresentationIn(drive.currentFolderId);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
}
