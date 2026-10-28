import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SensorProps } from "@dnd-kit/core";
import {
  LongPressDragSensor,
  type LongPressDragOptions,
} from "./longPressDragSensor";

const OPTIONS: LongPressDragOptions = {
  delay: 250,
  tolerance: 5,
  distance: 10,
};
const ORIGIN = { x: 100, y: 200 };

function touchEvent(
  type: string,
  point: { x: number; y: number } | null,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = point ? [{ clientX: point.x, clientY: point.y }] : [];
  Object.defineProperties(event, {
    touches: { value: type === "touchend" ? [] : touches },
    changedTouches: { value: touches },
  });
  return event;
}

function press(overrides: Partial<LongPressDragOptions> = {}) {
  const target = document.createElement("div");
  document.body.append(target);
  const callbacks = {
    onAbort: vi.fn(),
    onPending: vi.fn(),
    onStart: vi.fn(),
    onMove: vi.fn(),
    onEnd: vi.fn(),
    onCancel: vi.fn(),
  };
  target.addEventListener(
    "touchstart",
    (event) => {
      new LongPressDragSensor({
        active: "file:a",
        event,
        options: { ...OPTIONS, ...overrides },
        ...callbacks,
      } as unknown as SensorProps<LongPressDragOptions>);
    },
    { once: true },
  );
  target.dispatchEvent(touchEvent("touchstart", ORIGIN));

  const move = (dx: number, dy: number): Event => {
    const event = touchEvent("touchmove", {
      x: ORIGIN.x + dx,
      y: ORIGIN.y + dy,
    });
    target.dispatchEvent(event);
    return event;
  };
  return { target, ...callbacks, move };
}

describe("LongPressDragSensor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  describe("누르는 동안", () => {
    it("재빨리 쓸면 끌기를 포기하고 스크롤을 막지 않는다", () => {
      const drag = press();

      vi.advanceTimersByTime(50);
      const swipe = drag.move(0, 6);

      expect(drag.onAbort).toHaveBeenCalledExactlyOnceWith("file:a");
      expect(drag.onCancel).toHaveBeenCalledTimes(1);
      expect(drag.onStart).not.toHaveBeenCalled();
      expect(swipe.defaultPrevented).toBe(false);
    });

    it("가로로 쓸어도 포기한다", () => {
      const drag = press();

      drag.move(-7, 0);

      expect(drag.onCancel).toHaveBeenCalledTimes(1);
    });

    it("포기한 뒤에는 오래 기다리거나 더 움직여도 끌기를 시작하지 않는다", () => {
      const drag = press();
      drag.move(0, 6);

      vi.advanceTimersByTime(600);
      const later = drag.move(0, 40);

      expect(drag.onStart).not.toHaveBeenCalled();
      expect(drag.onMove).not.toHaveBeenCalled();
      expect(drag.onCancel).toHaveBeenCalledTimes(1);
      expect(later.defaultPrevented).toBe(false);
    });

    it("5px 이하로 움직인 손가락은 물러나지 않고 계속 누르는 것으로 본다", () => {
      const drag = press();

      vi.advanceTimersByTime(100);
      drag.move(3, -5);

      expect(drag.onCancel).not.toHaveBeenCalled();
      expect(drag.onAbort).not.toHaveBeenCalled();
    });

    it("움직이지 않고 떼면(탭) 끌기를 시작하지 않고 끝낸다", () => {
      const drag = press();

      vi.advanceTimersByTime(120);
      drag.target.dispatchEvent(touchEvent("touchend", null));

      expect(drag.onAbort).toHaveBeenCalledExactlyOnceWith("file:a");
      expect(drag.onEnd).toHaveBeenCalledTimes(1);
      expect(drag.onStart).not.toHaveBeenCalled();
    });
  });

  describe("다 누른 뒤", () => {
    it("10px 넘게 움직이면 누른 자리에서 끌기를 시작하고 스크롤을 막는다", () => {
      const drag = press();
      vi.advanceTimersByTime(250);

      const hold = drag.move(0, 11);

      expect(drag.onStart).toHaveBeenCalledExactlyOnceWith(ORIGIN);
      expect(drag.onMove).toHaveBeenCalledExactlyOnceWith({
        x: ORIGIN.x,
        y: ORIGIN.y + 11,
      });
      expect(hold.defaultPrevented).toBe(true);
      expect(drag.onAbort).not.toHaveBeenCalled();
    });

    it("움직임이 5px을 넘어도 다 눌렀으면 포기하지 않는다", () => {
      const drag = press();
      vi.advanceTimersByTime(250);

      drag.move(0, 8);

      expect(drag.onCancel).not.toHaveBeenCalled();
    });

    it("10px 이하로만 움직이면 아직 시작하지 않지만 스크롤은 막는다", () => {
      const drag = press();
      vi.advanceTimersByTime(250);

      const small = drag.move(6, 6);

      expect(drag.onStart).not.toHaveBeenCalled();
      expect(drag.onMove).not.toHaveBeenCalled();
      expect(small.defaultPrevented).toBe(true);
    });

    it("가로 10px 넘게 움직여도 시작한다", () => {
      const drag = press();
      vi.advanceTimersByTime(250);

      drag.move(11, 0);

      expect(drag.onStart).toHaveBeenCalledTimes(1);
    });

    it("시작한 뒤에는 움직일 때마다 알리고, 떼면 끝낸다", () => {
      const drag = press();
      vi.advanceTimersByTime(300);
      drag.move(0, 12);

      drag.move(0, 40);
      drag.move(5, 80);
      drag.target.dispatchEvent(touchEvent("touchend", null));

      expect(drag.onMove).toHaveBeenCalledTimes(3);
      expect(drag.onMove).toHaveBeenLastCalledWith({
        x: ORIGIN.x + 5,
        y: ORIGIN.y + 80,
      });
      expect(drag.onEnd).toHaveBeenCalledTimes(1);
      expect(drag.onAbort).not.toHaveBeenCalled();
    });

    it("시작한 뒤 터치가 끊기면 끌기를 취소한다", () => {
      const drag = press();
      vi.advanceTimersByTime(300);
      drag.move(0, 12);

      drag.target.dispatchEvent(touchEvent("touchcancel", null));

      expect(drag.onCancel).toHaveBeenCalledTimes(1);
      expect(drag.onAbort).not.toHaveBeenCalled();
    });
  });

  describe("움직이지 않고 계속 누르면", () => {
    it("아무리 오래 눌러도 끌기를 시작하지도 포기하지도 않는다 (길게 누르기 메뉴 몫이다)", () => {
      const drag = press();

      vi.advanceTimersByTime(5000);

      expect(drag.onStart).not.toHaveBeenCalled();
      expect(drag.onAbort).not.toHaveBeenCalled();
      expect(drag.onCancel).not.toHaveBeenCalled();
    });

    it("메뉴가 열릴 만큼 누른 뒤에도 10px 넘게 움직이면 끌기를 시작한다", () => {
      const drag = press();
      vi.advanceTimersByTime(800);

      const late = drag.move(0, 50);

      expect(drag.onStart).toHaveBeenCalledExactlyOnceWith(ORIGIN);
      expect(late.defaultPrevented).toBe(true);
    });

    it("움직이지 않고 오래 눌렀다 떼면 끌기 없이 끝낸다", () => {
      const drag = press();
      vi.advanceTimersByTime(800);

      drag.target.dispatchEvent(touchEvent("touchend", null));

      expect(drag.onAbort).toHaveBeenCalledExactlyOnceWith("file:a");
      expect(drag.onEnd).toHaveBeenCalledTimes(1);
      expect(drag.onStart).not.toHaveBeenCalled();
    });
  });

  describe("활성화", () => {
    const [activator] = LongPressDragSensor.activators;

    it("터치 시작에서 손가락 하나일 때만 센서를 만든다", () => {
      expect(activator?.eventName).toBe("onTouchStart");
      const one = { nativeEvent: { touches: [{}] } } as never;
      const two = { nativeEvent: { touches: [{}, {}] } } as never;

      expect(activator?.handler(one)).toBe(true);
      expect(activator?.handler(two)).toBe(false);
    });

    it("창에 non-passive touchmove 리스너를 미리 두고 정리한다", () => {
      const add = vi.spyOn(window, "addEventListener");
      const remove = vi.spyOn(window, "removeEventListener");

      const teardown = LongPressDragSensor.setup();
      expect(add).toHaveBeenCalledWith("touchmove", expect.any(Function), {
        capture: false,
        passive: false,
      });
      teardown();

      expect(remove).toHaveBeenCalledWith("touchmove", expect.any(Function));
    });
  });
});
