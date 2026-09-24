import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { BackgroundPickerModal } from "./BackgroundPickerModal";
import { INITIAL_BACKGROUNDS } from "#shared";

describe("BackgroundPickerModal", () => {
  it("should not render when isOpen is false", () => {
    const { container } = render(
      <BackgroundPickerModal
        isOpen={false}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("should render 10 backgrounds and trigger onSelect when clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <BackgroundPickerModal
        isOpen={true}
        onClose={onClose}
        selectedBackgroundId={INITIAL_BACKGROUNDS[0].id}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("모션 배경 라이브러리")).toBeInTheDocument();
    expect(screen.getByText("은은한 빛의 흐름")).toBeInTheDocument();

    const secondBg = INITIAL_BACKGROUNDS[1];
    const item = screen.getByTestId(`bg-item-${secondBg.id}`);
    fireEvent.click(item);

    expect(onSelect).toHaveBeenCalledWith(secondBg.id);
    expect(onClose).toHaveBeenCalled();
  });

  it("should filter items when tag filter is clicked", () => {
    render(
      <BackgroundPickerModal
        isOpen={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const warmFilter = screen.getByRole("button", { name: "따뜻한" });
    fireEvent.click(warmFilter);

    expect(screen.getByText("은은한 빛의 흐름")).toBeInTheDocument();
  });
});
