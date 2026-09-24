import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { VideoLayer } from "./VideoLayer";

describe("VideoLayer Component (Dual Video A/B Crossfade Loop)", () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi
      .fn()
      .mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
  });

  it("should render two video slots (A and B) with autoplay, muted, loop, and playsinline", () => {
    render(<VideoLayer src="https://media.example.com/loop1.mp4" />);

    const videoA = screen.getByTestId("video-slot-a") as HTMLVideoElement;
    const videoB = screen.getByTestId("video-slot-b") as HTMLVideoElement;

    expect(videoA).toBeInTheDocument();
    expect(videoB).toBeInTheDocument();

    expect(videoA.autoplay).toBe(true);
    expect(videoA.muted).toBe(true);
    expect(videoA.loop).toBe(true);
    expect(videoA.playsInline).toBe(true);

    expect(videoB.autoplay).toBe(true);
    expect(videoB.muted).toBe(true);
    expect(videoB.loop).toBe(true);
    expect(videoB.playsInline).toBe(true);
  });

  it("should start with Video Slot A active (opacity 1) and Slot B inactive (opacity 0)", () => {
    render(<VideoLayer src="https://media.example.com/loop1.mp4" />);

    const videoA = screen.getByTestId("video-slot-a");
    const videoB = screen.getByTestId("video-slot-b");

    expect(videoA).toHaveStyle({ opacity: "1" });
    expect(videoB).toHaveStyle({ opacity: "0" });
    expect(videoA).toHaveAttribute(
      "src",
      "https://media.example.com/loop1.mp4",
    );
  });

  it("should maintain continuous loop without changing source when same src is passed on rerender", () => {
    const { rerender } = render(
      <VideoLayer src="https://media.example.com/loop1.mp4" />,
    );

    const videoA = screen.getByTestId("video-slot-a");
    expect(videoA).toHaveAttribute(
      "src",
      "https://media.example.com/loop1.mp4",
    );

    rerender(<VideoLayer src="https://media.example.com/loop1.mp4" />);

    expect(videoA).toHaveAttribute(
      "src",
      "https://media.example.com/loop1.mp4",
    );
    expect(videoA).toHaveStyle({ opacity: "1" });
  });

  it("should crossfade to Slot B when src changes to a new video", () => {
    const { rerender } = render(
      <VideoLayer src="https://media.example.com/loop1.mp4" />,
    );

    const videoA = screen.getByTestId("video-slot-a");
    const videoB = screen.getByTestId("video-slot-b");

    expect(videoA).toHaveStyle({ opacity: "1" });
    expect(videoB).toHaveStyle({ opacity: "0" });

    act(() => {
      rerender(<VideoLayer src="https://media.example.com/loop2.mp4" />);
    });

    expect(videoB).toHaveAttribute(
      "src",
      "https://media.example.com/loop2.mp4",
    );
    expect(videoB).toHaveStyle({ opacity: "1" });
    expect(videoA).toHaveStyle({ opacity: "0" });
  });

  it("should render preload video element when nextSrc is provided", () => {
    render(
      <VideoLayer
        src="https://media.example.com/loop1.mp4"
        nextSrc="https://media.example.com/loop2.mp4"
      />,
    );

    const preloadVideo = screen.getByTestId("video-preload");
    expect(preloadVideo).toBeInTheDocument();
    expect(preloadVideo).toHaveAttribute(
      "src",
      "https://media.example.com/loop2.mp4",
    );
    expect(preloadVideo).toHaveAttribute("preload", "auto");
  });
});
