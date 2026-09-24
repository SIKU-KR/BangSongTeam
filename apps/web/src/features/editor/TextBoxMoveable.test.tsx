import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TextBoxMoveable } from "./TextBoxMoveable";

// jsdom에는 레이아웃·transition이 없으므로 Moveable은 updateRect만 노출하는 대역으로 바꾼다
const updateRect = vi.hoisted(() => vi.fn());
vi.mock("react-moveable", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    default: forwardRef(function MoveableStub(_props, ref) {
      useImperativeHandle(ref, () => ({ updateRect }));
      return null;
    }),
  };
});

describe("TextBoxMoveable", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let isAnimating: boolean;
  let target: HTMLDivElement;

  const flushFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb(0));
  };

  const renderMoveable = () =>
    render(
      <TextBoxMoveable
        target={target}
        refreshKey="song-a"
        onPreview={() => {}}
        onCommit={() => {}}
      />,
    );

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      nextFrameId += 1;
      frames.set(nextFrameId, cb);
      return nextFrameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    isAnimating = true;
    target = document.createElement("div");
    target.getAnimations = () => (isAnimating ? [{} as Animation] : []);
    updateRect.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("곡 전환 등으로 박스 transition이 도는 동안 매 프레임 컨트롤 박스를 다시 맞춘다", () => {
    renderMoveable();
    updateRect.mockClear();

    target.dispatchEvent(new Event("transitionrun"));
    flushFrame();
    flushFrame();
    expect(updateRect).toHaveBeenCalledTimes(2);

    // transition이 끝난 프레임에서 최종 위치로 한 번 더 맞추고 멈춘다
    isAnimating = false;
    flushFrame();
    expect(updateRect).toHaveBeenCalledTimes(3);
    expect(frames.size).toBe(0);
  });

  it("transitionend에서 최종 위치로 한 번 더 맞춘다", () => {
    isAnimating = false;
    renderMoveable();
    updateRect.mockClear();

    target.dispatchEvent(new Event("transitionend"));
    flushFrame();
    expect(updateRect).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it("언마운트하면 대기 중인 프레임과 리스너를 정리한다", () => {
    const { unmount } = renderMoveable();
    target.dispatchEvent(new Event("transitionrun"));
    expect(frames.size).toBe(1);

    unmount();
    expect(frames.size).toBe(0);
    target.dispatchEvent(new Event("transitionrun"));
    expect(frames.size).toBe(0);
  });
});
