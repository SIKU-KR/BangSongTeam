import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { OverlayLayer } from "./OverlayLayer";

describe("OverlayLayer Component", () => {
  it("should render overlay with default opacity 40% (0.4) and color #000000", () => {
    render(<OverlayLayer />);
    const overlay = screen.getByTestId("overlay-layer");
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveStyle({
      opacity: "0.4",
      backgroundColor: "#000000",
      willChange: "opacity",
    });
  });

  it("should apply custom opacity and custom color", () => {
    render(<OverlayLayer opacity={75} color="#112233" />);
    const overlay = screen.getByTestId("overlay-layer");
    expect(overlay).toHaveStyle({
      opacity: "0.75",
      backgroundColor: "#112233",
    });
  });

  it("should force opacity to 1 (total blackout) when isBlackout is true", () => {
    const { rerender } = render(
      <OverlayLayer opacity={20} isBlackout={false} />,
    );
    expect(screen.getByTestId("overlay-layer")).toHaveStyle({
      opacity: "0.2",
    });

    rerender(<OverlayLayer opacity={20} isBlackout={true} />);
    expect(screen.getByTestId("overlay-layer")).toHaveStyle({
      opacity: "1",
    });
  });

  it("should clamp opacity between 0 and 100", () => {
    const { rerender } = render(<OverlayLayer opacity={-20} />);
    expect(screen.getByTestId("overlay-layer")).toHaveStyle({
      opacity: "0",
    });

    rerender(<OverlayLayer opacity={150} />);
    expect(screen.getByTestId("overlay-layer")).toHaveStyle({
      opacity: "1",
    });
  });
});
