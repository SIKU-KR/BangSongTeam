import { useEffect, useState } from "react";

/** 마지막 포인터 움직임 뒤 커서와 종료 버튼을 숨기기까지의 시간 */
export const POINTER_IDLE_TIMEOUT_MS = 2500;

/**
 * 운영자가 마우스를 움직이거나 누른 직후에만 true. 송출 화면은 이 값으로 커서와
 * 종료 버튼을 숨겨 청중 화면에 남지 않게 한다.
 *
 * 처음에는 false다. Chrome은 레이아웃이 바뀔 때 같은 좌표로 pointermove를 보내므로
 * 좌표가 그대로인 움직임은 무시한다.
 */
export function useIdlePointer(timeoutMs = POINTER_IDLE_TIMEOUT_MS): boolean {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastX: number | null = null;
    let lastY: number | null = null;

    const wake = (): void => {
      setIsActive(true);
      clearTimeout(timer);
      timer = setTimeout(() => setIsActive(false), timeoutMs);
    };

    const handleMove = (event: MouseEvent): void => {
      if (event.clientX === lastX && event.clientY === lastY) return;
      lastX = event.clientX;
      lastY = event.clientY;
      wake();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerdown", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerdown", wake);
    };
  }, [timeoutMs]);

  return isActive;
}
