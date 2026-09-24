import { describe, it, expect } from "vitest";
import {
  clampRect,
  computeDragRect,
  computeResizeRect,
  rectToPercent,
  rectToPosition,
  snapRect,
  type PercentRect,
} from "./textBoxDrag";

const stage = { left: 100, top: 50, width: 960, height: 540 };

describe("rectToPercent", () => {
  it("화면 px 사각형을 스테이지 기준 %로 환산한다 (스케일/줌 무관)", () => {
    const box = { left: 100 + 96, top: 50 + 54, width: 480, height: 108 };
    expect(rectToPercent(box, stage)).toEqual({
      left: 10,
      top: 10,
      width: 50,
      height: 20,
    });
  });
});

describe("clampRect", () => {
  it("폭을 20~90%로 제한한다", () => {
    expect(clampRect({ left: 30, top: 40, width: 5, height: 10 }).width).toBe(
      20,
    );
    expect(clampRect({ left: 5, top: 40, width: 95, height: 10 }).width).toBe(
      90,
    );
  });

  it("박스가 상하좌우 5% 안전 여백을 벗어나지 않게 이동시킨다", () => {
    const r = clampRect({ left: 80, top: 90, width: 30, height: 20 });
    expect(r.left + r.width).toBeLessThanOrEqual(95);
    expect(r.top + r.height).toBeLessThanOrEqual(95);

    const r2 = clampRect({ left: -10, top: -10, width: 30, height: 20 });
    expect(r2.left).toBe(5);
    expect(r2.top).toBe(5);
  });

  it("높이가 안전 영역보다 커도 top은 5%에 고정한다", () => {
    const r = clampRect({ left: 30, top: 50, width: 40, height: 100 });
    expect(r.top).toBe(5);
  });
});

describe("computeDragRect", () => {
  const start: PercentRect = { left: 20, top: 30, width: 40, height: 10 };

  it("포인터 이동량(px)을 스테이지 %로 환산해 박스를 이동한다", () => {
    const r = computeDragRect(start, 96, 54, stage);
    expect(r).toMatchObject({ left: 30, top: 40, width: 40, height: 10 });
  });
});

describe("snapRect", () => {
  it("박스 중심이 50%에 가까우면 중앙선에 스냅한다", () => {
    const { rect, guides } = snapRect(
      { left: 30.4, top: 44.6, width: 40, height: 10 },
      1,
    );
    expect(rect.left + rect.width / 2).toBeCloseTo(50);
    expect(rect.top + rect.height / 2).toBeCloseTo(50);
    expect(guides).toEqual({ vertical: true, horizontal: true });
  });

  it("임계값 밖이면 스냅하지 않는다", () => {
    const input = { left: 20, top: 20, width: 40, height: 10 };
    const { rect, guides } = snapRect(input, 1);
    expect(rect).toEqual(input);
    expect(guides).toEqual({ vertical: false, horizontal: false });
  });

  it("축별로 독립적으로 스냅한다", () => {
    const { guides } = snapRect(
      { left: 30.2, top: 20, width: 40, height: 10 },
      1,
    );
    expect(guides).toEqual({ vertical: true, horizontal: false });
  });
});

describe("computeResizeRect", () => {
  const start: PercentRect = { left: 20, top: 40, width: 40, height: 10 };

  it("동쪽 핸들: 왼쪽 가장자리를 고정하고 폭만 변경한다", () => {
    const r = computeResizeRect(start, 1, 96, stage);
    expect(r).toMatchObject({ left: 20, width: 50, top: 40, height: 10 });
  });

  it("서쪽 핸들: 오른쪽 가장자리를 고정하고 폭과 left를 변경한다", () => {
    const r = computeResizeRect(start, -1, -96, stage);
    expect(r.left).toBeCloseTo(10);
    expect(r.width).toBeCloseTo(50);
    expect(r.left + r.width).toBeCloseTo(60);
  });

  it("폭은 20~90% 범위로 제한된다", () => {
    expect(computeResizeRect(start, 1, -9999, stage).width).toBe(20);
    expect(computeResizeRect(start, 1, 9999, stage).width).toBeLessThanOrEqual(
      90,
    );
  });
});

describe("rectToPosition", () => {
  it("중심 좌표 기준의 custom 앵커 위치로 변환한다", () => {
    expect(
      rectToPosition({ left: 30, top: 40, width: 40, height: 20 }),
    ).toEqual({
      anchor: "custom",
      xPercent: 50,
      yPercent: 50,
      widthPercent: 40,
    });
  });

  it("스키마 범위(좌표 5~95, 폭 20~90)로 clamp 하고 소수 둘째 자리로 반올림한다", () => {
    const p = rectToPosition({ left: 0, top: 0, width: 5, height: 2 });
    expect(p.xPercent).toBe(5);
    expect(p.yPercent).toBe(5);
    expect(p.widthPercent).toBe(20);

    const q = rectToPosition({
      left: 10.123456,
      top: 20,
      width: 33.333333,
      height: 10,
    });
    expect(q.xPercent).toBe(26.79);
    expect(q.widthPercent).toBe(33.33);
  });
});
