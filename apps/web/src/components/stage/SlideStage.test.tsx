import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { SlideStage } from "./SlideStage";
import { DEFAULT_DECK_STYLE } from "@repo/shared";
import type { Slide, DeckStyle } from "@repo/shared";

describe("SlideStage Integration Component", () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi
      .fn()
      .mockResolvedValue(undefined);
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

    const virtualStage = screen.getByTestId("virtual-slide-stage");
    expect(virtualStage).toBeInTheDocument();
    expect(virtualStage).toHaveStyle({
      width: "1920px",
      height: "1080px",
    });

    expect(screen.getByTestId("video-layer-container")).toBeInTheDocument();
    expect(screen.getByTestId("overlay-layer")).toBeInTheDocument();
    expect(screen.getByTestId("text-layer-container")).toBeInTheDocument();
    expect(
      screen.getByText("꽃들도 구름도 바람도 넓은 바다도"),
    ).toBeInTheDocument();
  });

  it("should apply scale transform calculated for current resolution", () => {
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

  it("블랙아웃은 가사까지 함께 가린다", () => {
    render(
      <SlideStage slide={mockSlide} style={mockStyle} isBlackout={true} />,
    );

    expect(screen.getByTestId("overlay-layer")).toHaveStyle({ opacity: "1" });
    expect(screen.getByTestId("text-layer-container")).toHaveStyle({
      opacity: "0",
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
    expect(
      screen.getByText("꽃들도 구름도 바람도 넓은 바다도"),
    ).toBeInTheDocument();

    rerender(<SlideStage slide={nextSlide} style={mockStyle} />);
    expect(
      screen.getByText("하늘을 울리며 노래하는 바다여"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("꽃들도 구름도 바람도 넓은 바다도"),
    ).not.toBeInTheDocument();
  });

  it("staticBackground이면 영상 없이 포스터 이미지로 Layer 1을 그린다 (썸네일)", () => {
    const { container } = render(
      <SlideStage
        slide={mockSlide}
        style={mockStyle}
        posterUrl="/api/media/poster1.jpg"
        staticBackground
        containerDimensions={{ width: 176, height: 99 }}
      />,
    );

    expect(container.querySelector("video")).toBeNull();
    expect(
      screen.queryByTestId("video-layer-container"),
    ).not.toBeInTheDocument();
    const layer = screen.getByTestId("static-background-layer");
    expect(layer.querySelector("img")).toHaveAttribute(
      "src",
      "/api/media/poster1.jpg",
    );
    expect(screen.getByTestId("overlay-layer")).toBeInTheDocument();
    expect(
      screen.getByText("꽃들도 구름도 바람도 넓은 바다도"),
    ).toBeInTheDocument();
  });
});
