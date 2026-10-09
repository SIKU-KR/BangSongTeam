import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import {
  VideoLayer,
  FADE_MS,
  FIRST_FRAME_TIMEOUT_MS,
  HEALTHY_PLAYBACK_MS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  STALL_RELOAD_MS,
} from "./VideoLayer";

const LOOP1 = "https://media.example.com/loop1.mp4";
const LOOP2 = "https://media.example.com/loop2.mp4";
const LOOP3 = "https://media.example.com/loop3.mp4";

function slotA(): HTMLVideoElement {
  return screen.getByTestId("video-slot-a") as HTMLVideoElement;
}

function slotB(): HTMLVideoElement {
  return screen.getByTestId("video-slot-b") as HTMLVideoElement;
}

function fire(video: HTMLVideoElement | Window, type: string): void {
  act(() => {
    fireEvent(video, new Event(type));
  });
}

function firstFrame(video: HTMLVideoElement): void {
  fire(video, "playing");
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function markStarved(video: HTMLVideoElement): void {
  Object.defineProperty(video, "paused", { configurable: true, value: false });
  Object.defineProperty(video, "readyState", {
    configurable: true,
    value: HTMLMediaElement.HAVE_CURRENT_DATA,
  });
}

function setCurrentTime(video: HTMLVideoElement, seconds: number): void {
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    value: seconds,
  });
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: online,
  });
}

function markErrored(video: HTMLVideoElement): void {
  Object.defineProperty(video, "error", {
    configurable: true,
    value: { code: 2 },
  });
}

describe("VideoLayer", () => {
  let play: ReturnType<typeof vi.fn<HTMLMediaElement["play"]>>;
  let pause: ReturnType<typeof vi.fn<HTMLMediaElement["pause"]>>;
  let load: ReturnType<typeof vi.fn<HTMLMediaElement["load"]>>;

  beforeEach(() => {
    vi.useFakeTimers();
    play = vi.fn<HTMLMediaElement["play"]>().mockResolvedValue(undefined);
    pause = vi.fn();
    load = vi.fn();
    window.HTMLMediaElement.prototype.play = play;
    window.HTMLMediaElement.prototype.pause = pause;
    window.HTMLMediaElement.prototype.load = load;
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, "onLine");
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

  it("교차 전환 중에는 새 슬롯이 위에서 나타나고 앞 슬롯은 끝날 때까지 불투명하게 남는다", () => {
    const { rerender } = render(<VideoLayer src={LOOP1} nextSrc={LOOP2} />);
    expect(slotA()).toHaveStyle({ zIndex: "1" });
    expect(slotA().style.transition).toBe(`opacity ${FADE_MS}ms ease-in-out`);

    rerender(<VideoLayer src={LOOP2} />);
    firstFrame(slotB());

    expect(slotB()).toHaveStyle({ zIndex: "1" });
    expect(slotB().style.transition).toBe(`opacity ${FADE_MS}ms ease-in-out`);
    expect(slotA()).toHaveStyle({ zIndex: "0" });
    expect(slotA().style.transition).toBe(`opacity 0ms linear ${FADE_MS}ms`);
  });

  it("새 영상이 보이기 시작하면 onReveal을 한 번만 부른다", () => {
    const onReveal = vi.fn();
    const { rerender } = render(<VideoLayer src={LOOP1} onReveal={onReveal} />);

    rerender(<VideoLayer src={LOOP2} onReveal={onReveal} />);
    firstFrame(slotB());
    advance(FIRST_FRAME_TIMEOUT_MS);
    expect(onReveal).toHaveBeenCalledTimes(1);

    rerender(<VideoLayer src={LOOP3} onReveal={onReveal} />);
    advance(FIRST_FRAME_TIMEOUT_MS);
    firstFrame(slotA());
    expect(onReveal).toHaveBeenCalledTimes(2);
  });

  it("보이는 영상에 오류가 나면 간격을 늘려 가며 다시 불러와 재생한다", () => {
    render(<VideoLayer src={LOOP1} />);
    play.mockClear();

    fire(slotA(), "error");
    advance(RETRY_BASE_MS - 1);
    expect(load).not.toHaveBeenCalled();

    advance(1);
    expect(load.mock.contexts).toEqual([slotA()]);
    expect(play.mock.contexts).toContain(slotA());

    fire(slotA(), "error");
    advance(RETRY_BASE_MS);
    expect(load).toHaveBeenCalledTimes(1);
    advance(RETRY_BASE_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("오류가 잇따라도 재시도 사이에 다시 불러오지 않는다", () => {
    render(<VideoLayer src={LOOP1} />);

    fire(slotA(), "error");
    fire(slotA(), "error");
    fire(slotA(), "error");
    advance(RETRY_BASE_MS);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("보이는 영상이 멈추면 다시 재생하고, 쉬는 슬롯은 건드리지 않는다", () => {
    render(<VideoLayer src={LOOP1} nextSrc={LOOP2} />);
    play.mockClear();

    fire(slotB(), "pause");
    expect(play).not.toHaveBeenCalled();

    fire(slotA(), "pause");
    expect(play.mock.contexts).toEqual([slotA()]);
  });

  it("자동 재생이 막혔으면 키를 누를 때 다시 재생한다", () => {
    render(<VideoLayer src={LOOP1} />);
    play.mockClear();

    fire(window, "keydown");

    expect(play.mock.contexts).toEqual([slotA()]);
  });

  it("버퍼링이 이어져 재생이 나아가지 않으면 다시 불러온다", () => {
    render(<VideoLayer src={LOOP1} />);
    markStarved(slotA());

    fire(slotA(), "waiting");
    advance(STALL_RELOAD_MS + RETRY_BASE_MS);

    expect(load.mock.contexts).toEqual([slotA()]);
  });

  it("버퍼링 뒤 재생이 다시 시작되면 다시 불러오지 않는다", () => {
    render(<VideoLayer src={LOOP1} />);

    fire(slotA(), "stalled");
    fire(slotA(), "playing");
    advance(STALL_RELOAD_MS + RETRY_BASE_MS);

    expect(load).not.toHaveBeenCalled();
  });

  it("다시 불러오기를 기다리는 사이 재생이 돌아오면 다시 불러오지 않는다", () => {
    render(<VideoLayer src={LOOP1} />);
    markStarved(slotA());

    fire(slotA(), "waiting");
    advance(STALL_RELOAD_MS);
    fire(slotA(), "playing");
    advance(RETRY_MAX_MS);

    expect(load).not.toHaveBeenCalled();
  });

  it("느리게라도 데이터가 들어오고 있으면 다시 불러오지 않는다", () => {
    render(<VideoLayer src={LOOP1} />);
    markStarved(slotA());

    fire(slotA(), "waiting");
    for (let i = 0; i < 4; i += 1) {
      advance(STALL_RELOAD_MS - 1);
      fire(slotA(), "progress");
    }
    expect(load).not.toHaveBeenCalled();

    advance(STALL_RELOAD_MS + RETRY_BASE_MS);
    expect(load.mock.contexts).toEqual([slotA()]);
  });

  it("stalled 뒤 버퍼가 바닥나 waiting이 와도 멈춘 영상을 다시 불러온다", () => {
    render(<VideoLayer src={LOOP1} />);
    markStarved(slotA());

    fire(slotA(), "stalled");
    setCurrentTime(slotA(), 3);
    fire(slotA(), "waiting");
    advance(STALL_RELOAD_MS * 2 + RETRY_BASE_MS);

    expect(load.mock.contexts).toEqual([slotA()]);
  });

  it("일부러 멈춘 영상은 버퍼링으로 보지 않는다", () => {
    render(<VideoLayer src={LOOP1} />);

    fire(slotA(), "stalled");
    advance(STALL_RELOAD_MS + RETRY_MAX_MS);

    expect(load).not.toHaveBeenCalled();
  });

  it("오프라인에서 멈춘 영상은 다시 연결될 때 다시 불러온다", () => {
    setOnline(false);
    render(<VideoLayer src={LOOP1} />);
    markStarved(slotA());

    fire(slotA(), "waiting");
    advance(STALL_RELOAD_MS + RETRY_MAX_MS);
    expect(load).not.toHaveBeenCalled();

    setOnline(true);
    fire(window, "online");
    advance(RETRY_BASE_MS);
    expect(load.mock.contexts).toEqual([slotA()]);
  });

  it("다시 불러온 뒤 오래 재생되지 못하고 또 멈추면 재시도 간격을 늘린다", () => {
    render(<VideoLayer src={LOOP1} />);

    fire(slotA(), "error");
    advance(RETRY_BASE_MS);
    expect(load).toHaveBeenCalledTimes(1);

    markStarved(slotA());
    fire(slotA(), "playing");
    advance(RETRY_BASE_MS);
    fire(slotA(), "waiting");
    advance(STALL_RELOAD_MS + RETRY_BASE_MS);
    expect(load).toHaveBeenCalledTimes(1);

    advance(RETRY_BASE_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("끊김 없이 충분히 재생되면 재시도 간격을 처음으로 되돌린다", () => {
    render(<VideoLayer src={LOOP1} />);

    fire(slotA(), "error");
    advance(RETRY_BASE_MS);
    fire(slotA(), "playing");
    advance(HEALTHY_PLAYBACK_MS);

    fire(slotA(), "error");
    advance(RETRY_BASE_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("제한 시간으로 나타난 영상이 아직 받는 중이면 멈춤을 지켜본다", () => {
    const { rerender } = render(<VideoLayer src={LOOP1} />);

    rerender(<VideoLayer src={LOOP2} />);
    markStarved(slotB());
    advance(FIRST_FRAME_TIMEOUT_MS);
    advance(STALL_RELOAD_MS + RETRY_BASE_MS);

    expect(load.mock.contexts).toEqual([slotB()]);
  });

  it("재시도를 기다리는 사이 곡이 바뀌면 앞 슬롯을 다시 불러오지 않는다", () => {
    const { rerender } = render(<VideoLayer src={LOOP1} />);

    fire(slotA(), "error");
    rerender(<VideoLayer src={LOOP2} />);
    firstFrame(slotB());
    advance(RETRY_BASE_MS * 4);

    expect(load).not.toHaveBeenCalled();
  });

  it("미리 실어 둔 슬롯이 오류 상태면 재생 전에 다시 불러온다", () => {
    const { rerender } = render(<VideoLayer src={LOOP1} nextSrc={LOOP2} />);
    markErrored(slotB());
    play.mockClear();

    rerender(<VideoLayer src={LOOP2} />);

    expect(load.mock.contexts).toEqual([slotB()]);
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(
      play.mock.invocationCallOrder[0] ?? 0,
    );
    expect(play.mock.contexts).toContain(slotB());
  });

  it("미리 실어 둔 슬롯이 멀쩡하면 다시 불러오지 않는다", () => {
    const { rerender } = render(<VideoLayer src={LOOP1} nextSrc={LOOP2} />);

    rerender(<VideoLayer src={LOOP2} />);
    firstFrame(slotB());

    expect(load).not.toHaveBeenCalled();
  });
});
