import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ColorPickerField, isValidHex } from "./ColorPickerField";

describe("isValidHex", () => {
  it("3/6자리 hex만 허용한다 (DeckStyleSchema 정규식과 동일)", () => {
    expect(isValidHex("#FFF")).toBe(true);
    expect(isValidHex("#ffffff")).toBe(true);
    expect(isValidHex("#A7F3D0")).toBe(true);
    expect(isValidHex("#FF")).toBe(false);
    expect(isValidHex("#GGGGGG")).toBe(false);
    expect(isValidHex("FFFFFF")).toBe(false);
    expect(isValidHex("#FFFFFFF")).toBe(false);
  });
});

describe("ColorPickerField", () => {
  it("유효하지 않은 hex 입력은 커밋하지 않는다", () => {
    const onCommit = vi.fn();
    render(<ColorPickerField value="#FFFFFF" onCommit={onCommit} />);
    const input = screen.getByTestId("color-hex-input");

    fireEvent.change(input, { target: { value: "#F" } });
    expect(input).toHaveAttribute("aria-invalid", "true");

    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue("#FFFFFF");
  });

  it("유효한 hex는 blur 시 대문자로 커밋한다", () => {
    const onCommit = vi.fn();
    render(<ColorPickerField value="#FFFFFF" onCommit={onCommit} />);
    const input = screen.getByTestId("color-hex-input");

    fireEvent.change(input, { target: { value: "#a7f3d0" } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("#A7F3D0");
  });

  it("Enter로도 커밋하고, 값이 같으면 커밋하지 않는다", () => {
    const onCommit = vi.fn();
    render(<ColorPickerField value="#FFFFFF" onCommit={onCommit} />);
    const input = screen.getByTestId("color-hex-input");

    fireEvent.change(input, { target: { value: "#ffffff" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "#000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("#000");
  });

  it("토글 버튼으로 컬러피커 팝오버를 열고 닫는다", () => {
    render(<ColorPickerField value="#FFFFFF" onCommit={() => {}} />);
    expect(screen.queryByTestId("color-picker-popover")).toBeNull();

    fireEvent.click(screen.getByTestId("color-picker-toggle"));
    expect(screen.getByTestId("color-picker-popover")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("color-picker-popover")).toBeNull();
  });

  it("외부 value가 바뀌면 입력 표시가 따라간다", () => {
    const { rerender } = render(
      <ColorPickerField value="#FFFFFF" onCommit={() => {}} />,
    );
    rerender(<ColorPickerField value="#FBCFE8" onCommit={() => {}} />);
    expect(screen.getByTestId("color-hex-input")).toHaveValue("#FBCFE8");
  });
});
