import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { isLetterKey, isTypingTarget } from "../../lib/browser/keyboardTarget";
import type { ToastAction } from "./driveContext";

const TOAST_ID = "drive-toast";
const TOAST_DURATION_MS = 6000;

export interface UndoToastOptions {
  /** 대화 상자가 열려 있으면 Cmd/Ctrl+Z를 대화 상자 입력에 맡긴다 */
  isSuspended: boolean;
}

/**
 * 드라이브 알림 한 칸과 그 실행 취소.
 *
 * 알림은 하나만 띄우고 새 알림이 앞 알림을 바꾼다. 실행 취소가 걸린 알림이 떠 있는
 * 동안에는 Cmd/Ctrl+Z로도 되돌린다. `showToast`는 렌더마다 바뀌지 않아야
 * 드라이브 조작 콜백과 컨텍스트 값이 다시 만들어지지 않는다.
 */
export function useUndoToast({ isSuspended }: UndoToastOptions): {
  showToast: (message: string, action?: ToastAction) => void;
} {
  const [undoAction, setUndoAction] = useState<ToastAction | null>(null);

  const showToast = useCallback(
    (message: string, action?: ToastAction): void => {
      setUndoAction(action ?? null);
      toast(message, {
        id: TOAST_ID,
        testId: TOAST_ID,
        duration: TOAST_DURATION_MS,
        closeButton: true,
        action: action && {
          label: action.label,
          onClick: () => {
            action.run();
            setUndoAction(null);
          },
        },
        onDismiss: () => setUndoAction(null),
        onAutoClose: () => setUndoAction(null),
      });
    },
    [],
  );

  useEffect(() => {
    const action = undoAction;
    if (!action || isSuspended) return;
    const handleUndo = (event: KeyboardEvent): void => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        !isLetterKey(event, "z") ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      action.run();
      toast.dismiss(TOAST_ID);
      setUndoAction(null);
    };
    window.addEventListener("keydown", handleUndo);
    return () => window.removeEventListener("keydown", handleUndo);
  }, [undoAction, isSuspended]);

  return { showToast };
}
