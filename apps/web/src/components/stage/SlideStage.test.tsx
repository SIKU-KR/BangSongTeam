import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { SlideStage } from "./SlideStage";
import { DEFAULT_DECK_STYLE } from "@repo/shared";
import type { Slide, DeckStyle } from "@repo/shared";

describe("SlideStage Integration Component", () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.innerWidth = 1920;
    window.innerHeight = 1080;
  });

  const mockSlide: Slide = {
    id: "s_test_stage",
    order: 0,
    lines: ["꽃들도 구름도 바람도 넓은 바다도", "찬양하라 찬양하라 예수를"],
  };

  const mockStyle: DeckStyle = {
    ...DEFAULT_DECK_STYLE,
    overlayOpacity: 50,
  };

  it("should render 1920x1080 stage container with 3-Layer DOM hierarchy", () => {
    render(
      <SlideStage
        slide={mockSlide}
        style={mockStyle}
        backgroundUrl="https://media.example.com/loop1.mp4"
      />,
    );

    // 1920x1080 virtual stage
    const virtualStage = screen.getByTestId("virtual-slide-stage");
    expect(virtualStage).toBeInTheDocument();
    expect(virtualStage).toHaveStyle({
      width: "1920px",
      height: "1080px",
    });

    // Layer 1: Video
    expect(screen.getByTestId("video-layer-container")).toBeInTheDocument();
    // Layer 2: Overlay
    expect(screen.getByTestId("overlay-layer")).toBeInTheDocument();
    // Layer 3: Text
    expect(screen.getByTestId("text-layer-container")).toBeInTheDocument();
    expect(screen.getByText("꽃들도 구름도 바람도 넓은 바다도")).toBeInTheDocument();
  });

  it("should apply scale transform calculated for current resolution", () => {
    // 1280x720 container override -> scale = 2/3 (0.666667)
    render(
      <SlideStage
        slide={mockSlide}
        style={mockStyle}
        containerDimensions={{ width: 1280, height: 720 }}
      />,
    );

    const virtualStage = screen.getByTestId("virtual-slide-stage");
    expect(virtualStage.style.transform).toContain("scale(0.666666");
  });

  it("should propagate isBlackout prop to OverlayLayer", () => {
    const { rerender } = render(
      <SlideStage slide={mockSlide} style={mockStyle} isBlackout={false} />,
    );
    expect(screen.getByTestId("overlay-layer")).toHaveStyle({
      opacity: "0.5",
    });

    rerender(
      <SlideStage slide={mockSlide} style={mockStyle} isBlackout={true} />,
    );
    expect(screen.getByTestId("overlay-layer")).toHaveStyle({
      opacity: "1",
    });
  });

  it("should propagate isLyricsHidden prop to TextLayer", () => {
    const { rerender } = render(
      <SlideStage slide={mockSlide} style={mockStyle} isLyricsHidden={false} />,
    );
    expect(screen.getByTestId("text-layer-container")).toHaveStyle({
      opacity: "1",
    });

    rerender(
      <SlideStage slide={mockSlide} style={mockStyle} isLyricsHidden={true} />,
    );
    expect(screen.getByTestId("text-layer-container")).toHaveStyle({
      opacity: "0",
    });
  });

  it("should update text content instantly when slide advances", () => {
    const nextSlide: Slide = {
      id: "s_test_stage_2",
      order: 1,
      lines: ["하늘을 울리며 노래하는 바다여", "산들아 기뻐하며 춤출지어다"],
    };

    const { rerender } = render(
      <SlideStage slide={mockSlide} style={mockStyle} />,
    );
    expect(screen.getByText("꽃들도 구름도 바람도 넓은 바다도")).toBeInTheDocument();

    rerender(<SlideStage slide={nextSlide} style={mockStyle} />);
    expect(screen.getByText("하늘을 울리며 노래하는 바다여")).toBeInTheDocument();
    expect(
      screen.queryByText("꽃들도 구름도 바람도 넓은 바다도"),
    ).not.toBeInTheDocument();
  });
});
