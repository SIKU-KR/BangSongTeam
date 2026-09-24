import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { TextLayer } from "./TextLayer";
import { DEFAULT_DECK_STYLE, TEXT_SHADOW_PRESETS } from "#shared";
import type { Slide, DeckStyle } from "#shared";

describe("TextLayer Component", () => {
  const sampleSlide: Slide = {
    id: "s_test1",
    order: 0,
    lines: ["은혜로다 주의 은혜", "한량없는 주의 은혜"],
  };

  const defaultStyle: DeckStyle = {
    ...DEFAULT_DECK_STYLE,
  };

  it("should render slide lyric lines accurately", () => {
    render(<TextLayer slide={sampleSlide} style={defaultStyle} />);

    expect(screen.getByText("은혜로다 주의 은혜")).toBeInTheDocument();
    expect(screen.getByText("한량없는 주의 은혜")).toBeInTheDocument();
  });

  it("should apply percentage coordinates and transform from style.position", () => {
    const customStyle: DeckStyle = {
      ...defaultStyle,
      position: {
        anchor: "bottom-center",
        xPercent: 50,
        yPercent: 85,
        widthPercent: 70,
      },
    };

    render(<TextLayer slide={sampleSlide} style={customStyle} />);

    const textBox = screen.getByTestId("text-layer-box");
    expect(textBox).toHaveStyle({
      left: "50%",
      top: "85%",
      width: "70%",
      transform: "translate(-50%, -100%)",
    });
  });

  it("should apply middle-* and top-* anchor growth transform rules", () => {
    const middleStyle: DeckStyle = {
      ...defaultStyle,
      position: {
        anchor: "middle-center",
        xPercent: 50,
        yPercent: 50,
        widthPercent: 80,
      },
    };

    const { rerender } = render(
      <TextLayer slide={sampleSlide} style={middleStyle} />,
    );
    expect(screen.getByTestId("text-layer-box")).toHaveStyle({
      transform: "translate(-50%, -50%)",
    });

    const topStyle: DeckStyle = {
      ...defaultStyle,
      position: {
        anchor: "top-center",
        xPercent: 50,
        yPercent: 15,
        widthPercent: 80,
      },
    };

    rerender(<TextLayer slide={sampleSlide} style={topStyle} />);
    expect(screen.getByTestId("text-layer-box")).toHaveStyle({
      transform: "translate(-50%, 0)",
    });
  });

  it("should apply text shadow preset from textShadowLevel", () => {
    const strongShadowStyle: DeckStyle = {
      ...defaultStyle,
      textShadowLevel: "strong",
    };

    render(<TextLayer slide={sampleSlide} style={strongShadowStyle} />);
    const textBox = screen.getByTestId("text-layer-box");
    expect(textBox).toHaveStyle({
      textShadow: TEXT_SHADOW_PRESETS.strong,
    });
  });

  it("should hide lyrics (opacity: 0) when isLyricsHidden is true", () => {
    const { rerender } = render(
      <TextLayer
        slide={sampleSlide}
        style={defaultStyle}
        isLyricsHidden={false}
      />,
    );
    expect(screen.getByTestId("text-layer-container")).toHaveStyle({
      opacity: "1",
    });

    rerender(
      <TextLayer
        slide={sampleSlide}
        style={defaultStyle}
        isLyricsHidden={true}
      />,
    );
    expect(screen.getByTestId("text-layer-container")).toHaveStyle({
      opacity: "0",
    });
  });

  it("should render gracefully when slide is null or has empty lines", () => {
    render(<TextLayer slide={null} style={defaultStyle} />);
    expect(screen.getByTestId("text-layer-box")).toBeInTheDocument();
  });
  it("should expose the text box element through boxRef", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<TextLayer slide={sampleSlide} style={defaultStyle} boxRef={ref} />);
    expect(ref.current).toBe(screen.getByTestId("text-layer-box"));
  });

  it("should disable position transitions while interacting", () => {
    const { rerender } = render(
      <TextLayer slide={sampleSlide} style={defaultStyle} />,
    );
    expect(screen.getByTestId("text-layer-box").className).toContain(
      "transition-all",
    );

    rerender(
      <TextLayer slide={sampleSlide} style={defaultStyle} isInteracting />,
    );
    expect(screen.getByTestId("text-layer-box").className).not.toContain(
      "transition-all",
    );
  });
});
