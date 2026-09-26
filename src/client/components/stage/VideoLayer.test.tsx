import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { VideoLayer, FIRST_FRAME_TIMEOUT_MS } from "./VideoLayer";

const LOOP1 = "https://media.example.com/loop1.mp4";
const LOOP2 = "https://media.example.com/loop2.mp4";
const LOOP3 = "https://media.example.com/loop3.mp4";

function slotA(): HTMLVideoElement {
  return screen.getByTestId("video-slot-a") as HTMLVideoElement;
}

function slotB(): HTMLVideoElement {
  return screen.getByTestId("video-slot-b") as HTMLVideoElement;
}

function firstFrame(video: HTMLVideoElement): void {
  act(() => {
    fireEvent(video, new Event("playing"));
  });
}

describe("VideoLayer", () => {
  let play: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    window.HTMLMediaElement.prototype.play = play;
    window.HTMLMediaElement.prototype.pause = pause;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("두 슬롯 모두 음소거·반복·인라인 재생이고, 자동 재생 대신 직접 재생한다", () => {
    render(<VideoLayer src={LOOP1} />);

    for (const video of [slotA(), slotB()]) {
      expect(video.muted).toBe(true);
      expect(video.loop).toBe(true);
      expect(video.playsInline).toBe(true);
      expect(video.autoplay).toBe(false);
      expect(video).toHaveAttribute("preload", "auto");
    }
    expect(play.mock.contexts).toContain(slotA());
  });

  it("처음에는 A 슬롯만 보인다", () => {
    render(<VideoLayer src={LOOP1} />);

    expect(slotA()).toHaveAttribute("src", LOOP1);
    expect(slotA()).toHaveStyle({ opacity: "1" });
    expect(slotB()).toHaveStyle({ opacity: "0" });
  });

  it("다음 곡 영상은 숨은 별도 요소가 아니라 쉬는 슬롯에 일시정지로 실린다", () => {
    render(<VideoLayer src={LOOP1} nextSrc={LOOP2} />);

    expect(screen.queryByTestId("video-preload")).not.toBeInTheDocument();
    expect(slotB()).toHaveAttribute("src", LOOP2);
    expect(slotB()).toHaveStyle({ opacity: "0" });
    expect(play.mock.contexts).not.toContain(slotB());
  });

  it("같은 영상이면 다시 불러도 소스와 재생 상태가 그대로다", () => {
    const { rerender } = render(<VideoLayer src={LOOP1} nextSrc={LOOP2} />);
    play.mockClear();

    rerender(<VideoLayer src={LOOP1} nextSrc={LOOP2} />);
    act(() => {
      vi.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS);
    });

    expect(slotA()).toHaveAttribute("src", LOOP1);
    expect(slotA()).toHaveStyle({ opacity: "1" });
    expect(play).not.toHaveBeenCalled();
  });

  it("곡이 바뀌면 미리 실어 둔 슬롯을 재생하고, 첫 프레임이 나온 뒤에야 넘어간다", () => {
    const { rerender } = render(<VideoLayer src={LOOP1} nextSrc={LOOP2} />);

    rerender(<VideoLayer src={LOOP2} nextSrc={LOOP3} />);

    expect(slotB()).toHaveAttribute("src", LOOP2);
    expect(play.mock.contexts).toContain(slotB());
    expect(slotA()).toHaveStyle({ opacity: "1" });
    expect(slotB()).toHaveStyle({ opacity: "0" });

    firstFrame(slotB());

    expect(slotB()).toHaveStyle({ opacity: "1" });
    expect(slotA()).toHaveStyle({ opacity: "0" });
  });

  it("첫 프레임이 제한 시간 안에 오지 않으면 그냥 넘어간다", () => {
    const { rerender } = render(<VideoLayer src={LOOP1} />);

    rerender(<VideoLayer src={LOOP2} />);
    act(() => {
      vi.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS - 1);
    });
    expect(slotB()).toHaveStyle({ opacity: "0" });

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(slotB()).toHaveAttribute("src", LOOP2);
    expect(slotB()).toHaveStyle({ opacity: "1" });
    expect(slotA()).toHaveStyle({ opacity: "0" });
  });

  it("전환이 끝나면 앞 곡 슬롯을 멈추고 그 자리에 다음 곡 영상을 싣는다", () => {
    const { rerender } = render(<VideoLayer src={LOOP1} nextSrc={LOOP2} />);
    rerender(<VideoLayer src={LOOP2} nextSrc={LOOP3} />);
    firstFrame(slotB());

    expect(slotA()).toHaveAttribute("src", LOOP1);

    act(() => {
      vi.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS);
    });

    expect(pause.mock.contexts).toContain(slotA());
    expect(slotA()).toHaveAttribute("src", LOOP3);
    expect(slotA()).toHaveStyle({ opacity: "0" });
    expect(slotB()).toHaveStyle({ opacity: "1" });
  });

  it("준비를 기다리는 동안 곡이 또 바뀌면 마지막 곡으로 넘어간다", () => {
    const { rerender } = render(<VideoLayer src={LOOP1} />);

    rerender(<VideoLayer src={LOOP2} />);
    rerender(<VideoLayer src={LOOP3} />);
    firstFrame(slotB());

    expect(slotB()).toHaveAttribute("src", LOOP3);
    expect(slotB()).toHaveStyle({ opacity: "1" });
    expect(slotA()).toHaveStyle({ opacity: "0" });
  });

  it("배경이 없는 곡으로 넘어가면 재생 중이던 영상을 비우고, 다음 영상은 검은 화면에서 들어온다", () => {
    const { rerender } = render(<VideoLayer src={LOOP1} />);

    rerender(<VideoLayer src={undefined} />);

    expect(slotA()).not.toHaveAttribute("src");
    expect(slotA()).toHaveStyle({ opacity: "0" });
    expect(slotB()).toHaveStyle({ opacity: "0" });

    rerender(<VideoLayer src={LOOP2} />);
    firstFrame(slotB());

    expect(slotB()).toHaveAttribute("src", LOOP2);
    expect(slotB()).toHaveStyle({ opacity: "1" });
  });
});
