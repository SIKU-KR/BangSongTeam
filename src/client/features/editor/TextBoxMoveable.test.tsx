import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { TextBoxMoveable } from "./TextBoxMoveable";

const updateRect = vi.hoisted(() => vi.fn());
const stubProps = vi.hoisted(() => ({
  current: null as null | { onClick?: (e: { isDouble: boolean }) => void },
}));
vi.mock("react-moveable", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    default: forwardRef(function MoveableStub(
      props: { onClick?: (e: { isDouble: boolean }) => void },
      ref,
    ) {
      stubProps.current = props;
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

  it("스테이지 scale처럼 조상의 인라인 style이 바뀌면 컨트롤 박스를 다시 맞춘다", async () => {
    isAnimating = false;
    const stage = document.createElement("div");
    stage.appendChild(target);
    document.body.appendChild(stage);
    renderMoveable();
    updateRect.mockClear();

    stage.style.transform = "scale(0.5)";

    await waitFor(() => expect(updateRect).toHaveBeenCalledTimes(1));
    stage.remove();
  });

  it("언마운트하면 조상의 style 변화를 더는 따라가지 않는다", async () => {
    isAnimating = false;
    const stage = document.createElement("div");
    stage.appendChild(target);
    document.body.appendChild(stage);
    const { unmount } = renderMoveable();

    unmount();
    updateRect.mockClear();
    stage.style.transform = "scale(0.25)";
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateRect).not.toHaveBeenCalled();
    stage.remove();
  });

  it("더블클릭이면 onDoubleClick을 부르고 한 번 클릭은 무시한다", () => {
    const onDoubleClick = vi.fn();
    render(
      <TextBoxMoveable
        target={target}
        refreshKey="song-a"
        onPreview={() => {}}
        onCommit={() => {}}
        onDoubleClick={onDoubleClick}
      />,
    );

    stubProps.current?.onClick?.({ isDouble: false });
    expect(onDoubleClick).not.toHaveBeenCalled();
    stubProps.current?.onClick?.({ isDouble: true });
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });
});
