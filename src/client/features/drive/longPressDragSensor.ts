import type { TouchEvent as ReactTouchEvent } from "react";
import type { SensorInstance, SensorProps } from "@dnd-kit/core";
import type { Coordinates } from "@dnd-kit/utilities";

export interface LongPressDragOptions {
  /** 이 시간(ms) 눌러 둔 뒤에야 끌기를 시작할 수 있다 */
  delay: number;
  /** 누르는 동안 가로·세로로 이만큼(px) 넘게 움직이면 스크롤로 보고 물러난다 */
  tolerance: number;
  /** 다 눌러 둔 뒤 가로·세로로 이만큼(px) 넘게 움직이면 끌기를 시작한다 */
  distance: number;
}

type Phase = "pressing" | "armed" | "dragging";

function readCoordinates(event: Event): Coordinates | null {
  if (!("touches" in event)) return null;
  const { touches, changedTouches } = event as TouchEvent;
  const touch = touches[0] ?? changedTouches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function movedBeyond(
  from: Coordinates,
  to: Coordinates,
  limit: number,
): boolean {
  return Math.abs(to.x - from.x) > limit || Math.abs(to.y - from.y) > limit;
}

/**
 * 꾹 누른 뒤 움직여야 끌기가 시작되는 터치 센서.
 *
 * `delay` 동안 `tolerance`px 넘게 움직이면 스크롤로 보고 물러나, 재빨리 쓸어 목록을 스크롤하는 손가락이
 * 끌기로 읽히지 않는다. 다 누른 뒤 `distance`px 넘게 움직이면 끌기를 시작하고, 그때부터 스크롤을 막는다.
 *
 * dnd-kit의 `TouchSensor`는 `delay`가 차는 순간 움직이지 않아도 끌기를 시작한다. 행을 길게 눌러 메뉴를
 * 여는 Base UI 컨텍스트 메뉴는 움직이지 않고 500ms 누르고 있을 때 열리므로 둘이 겹쳐, 메뉴가 열릴 때까지
 * 끌기 칩이 떠 있다가 메뉴까지 열린다. 움직임으로 끌기를 가르면 움직이지 않는 누름은 메뉴 몫이 된다.
 * `distance`는 Base UI가 길게 누르기를 취소하는 움직임(10px)과 같게 두어, 끌기가 시작될 때는 메뉴의
 * 타이머도 멈춘다. 메뉴가 이미 열린 뒤에 움직여도 끌기는 시작되며, 그때 메뉴를 닫는 것은 쓰는 쪽이다.
 * @base-ui/react@1.8.0 context-menu/trigger/ContextMenuTrigger.mjs (`LONG_PRESS_DELAY`, `moveThreshold`)
 *
 * 움직이지 않고 떼면 끌기에 끼어들지 않으므로 느린 탭도 그대로 클릭이 된다.
 */
export class LongPressDragSensor implements SensorInstance {
  static activators = [
    {
      eventName: "onTouchStart" as const,
      handler: ({ nativeEvent }: ReactTouchEvent): boolean =>
        nativeEvent.touches.length <= 1,
    },
  ];

  /**
   * 끌기를 시작한 뒤의 `preventDefault`가 먹도록 창에 non-passive `touchmove` 리스너를 미리 둔다.
   * iOS Safari는 나중에 단 `touchmove` 리스너의 `preventDefault`를 무시한다.
   * @dnd-kit/core@6.3.1 dist/core.esm.js (`TouchSensor.setup`)
   */
  static setup(): () => void {
    const keepNonPassive = (): void => undefined;
    window.addEventListener("touchmove", keepNonPassive, {
      capture: false,
      passive: false,
    });
    return () => window.removeEventListener("touchmove", keepNonPassive);
  }

  autoScrollEnabled = true;

  private readonly props: SensorProps<LongPressDragOptions>;
  private readonly target: EventTarget;
  private readonly origin: Coordinates;
  private readonly armTimer: ReturnType<typeof setTimeout>;
  private phase: Phase = "pressing";

  constructor(props: SensorProps<LongPressDragOptions>) {
    this.props = props;
    this.target = props.event.target ?? document;
    this.origin = readCoordinates(props.event) ?? { x: 0, y: 0 };
    this.target.addEventListener("touchmove", this.handleMove, {
      passive: false,
    });
    this.target.addEventListener("touchend", this.handleEnd);
    this.target.addEventListener("touchcancel", this.handleCancel);
    this.armTimer = setTimeout(() => {
      this.phase = "armed";
    }, props.options.delay);
  }

  private readonly handleMove = (event: Event): void => {
    const current = readCoordinates(event);
    if (!current) return;
    const { tolerance, distance } = this.props.options;
    if (this.phase === "pressing") {
      if (movedBeyond(this.origin, current, tolerance)) this.handleCancel();
      return;
    }
    if (event.cancelable) event.preventDefault();
    if (this.phase === "armed") {
      if (!movedBeyond(this.origin, current, distance)) return;
      this.phase = "dragging";
      this.props.onStart(this.origin);
    }
    this.props.onMove(current);
  };

  private readonly handleEnd = (): void => this.finish("end");

  private readonly handleCancel = (): void => this.finish("cancel");

  private finish(outcome: "end" | "cancel"): void {
    const wasDragging = this.phase === "dragging";
    clearTimeout(this.armTimer);
    this.target.removeEventListener("touchmove", this.handleMove);
    this.target.removeEventListener("touchend", this.handleEnd);
    this.target.removeEventListener("touchcancel", this.handleCancel);
    if (!wasDragging) this.props.onAbort(this.props.active);
    if (outcome === "end") this.props.onEnd();
    else this.props.onCancel();
  }
}
