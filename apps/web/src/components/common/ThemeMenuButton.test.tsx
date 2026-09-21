import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { ThemeProvider } from "../../features/theme";
import { ThemeMenuButton } from "./ThemeMenuButton";

describe("ThemeMenuButton", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  it("should render full variant button with current theme label", () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeMenuButton variant="full" />
      </ThemeProvider>,
    );

    const button = screen.getByTestId("theme-menu-button");
    expect(button).toBeInTheDocument();
    expect(screen.getByText("라이트 모드")).toBeInTheDocument();
    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
  });

  it("should toggle dropdown menu when button is clicked", () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeMenuButton />
      </ThemeProvider>,
    );

    const button = screen.getByTestId("theme-menu-button");

    // Open dropdown
    fireEvent.click(button);
    expect(screen.getByTestId("theme-menu-dropdown")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-light")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-dark")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-system")).toBeInTheDocument();

    // Close dropdown on click again
    fireEvent.click(button);
    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
  });

  it("should switch theme when an option is selected and close dropdown", () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeMenuButton />
      </ThemeProvider>,
    );

    const button = screen.getByTestId("theme-menu-button");
    fireEvent.click(button);

    // Click '라이트 모드'
    const lightOption = screen.getByTestId("theme-option-light");
    act(() => {
      fireEvent.click(lightOption);
    });

    // Dropdown should close
    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();

    // Button label should update
    expect(screen.getByText("라이트 모드")).toBeInTheDocument();
    expect(window.localStorage.getItem("worship-theme")).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);

    // Now switch to '시스템 설정'
    fireEvent.click(button);
    const systemOption = screen.getByTestId("theme-option-system");
    act(() => {
      fireEvent.click(systemOption);
    });

    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
    expect(screen.getByText("시스템 설정")).toBeInTheDocument();
    expect(window.localStorage.getItem("worship-theme")).toBe("system");
  });

  it("should close dropdown when clicking outside", () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <div>
          <span data-testid="outside-area">Outside</span>
          <ThemeMenuButton />
        </div>
      </ThemeProvider>,
    );

    const button = screen.getByTestId("theme-menu-button");
    fireEvent.click(button);
    expect(screen.getByTestId("theme-menu-dropdown")).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(screen.getByTestId("outside-area"));
    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
  });

  it("should close dropdown when pressing Escape key", () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeMenuButton />
      </ThemeProvider>,
    );

    const button = screen.getByTestId("theme-menu-button");
    fireEvent.click(button);
    expect(screen.getByTestId("theme-menu-dropdown")).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
  });

  it("should render compact variant and work properly", () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeMenuButton variant="compact" />
      </ThemeProvider>,
    );

    const button = screen.getByTestId("theme-menu-button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("title", "테마 설정: 라이트 모드");

    fireEvent.click(button);
    expect(screen.getByTestId("theme-menu-dropdown")).toBeInTheDocument();
  });
});
