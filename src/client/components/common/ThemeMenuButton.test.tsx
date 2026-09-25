import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { ThemeProvider } from "#components/theme-provider";
import { ThemeMenuButton } from "./ThemeMenuButton";

describe("ThemeMenuButton", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  it("should render icon button labelled with the current theme", () => {
    render(
      <ThemeProvider defaultTheme="light" storageKey="worship-theme">
        <ThemeMenuButton />
      </ThemeProvider>,
    );

    const button = screen.getByTestId("theme-menu-button");
    expect(button).toHaveAccessibleName("테마 설정: 라이트 모드");
    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
  });

  it("should toggle dropdown menu when button is clicked", () => {
    render(
      <ThemeProvider defaultTheme="dark" storageKey="worship-theme">
        <ThemeMenuButton />
      </ThemeProvider>,
    );

    const button = screen.getByTestId("theme-menu-button");

    fireEvent.click(button);
    expect(screen.getByTestId("theme-menu-dropdown")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-light")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-dark")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-system")).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
  });

  it("should switch theme when an option is selected and close dropdown", () => {
    render(
      <ThemeProvider defaultTheme="dark" storageKey="worship-theme">
        <ThemeMenuButton />
      </ThemeProvider>,
    );

    const button = screen.getByTestId("theme-menu-button");
    fireEvent.click(button);

    const lightOption = screen.getByTestId("theme-option-light");
    act(() => {
      fireEvent.click(lightOption);
    });

    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();

    expect(button).toHaveAccessibleName("테마 설정: 라이트 모드");
    expect(window.localStorage.getItem("worship-theme")).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);

    fireEvent.click(button);
    const systemOption = screen.getByTestId("theme-option-system");
    act(() => {
      fireEvent.click(systemOption);
    });

    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
    expect(button).toHaveAccessibleName("테마 설정: 시스템 설정");
    expect(window.localStorage.getItem("worship-theme")).toBe("system");
  });

  it("should close dropdown when clicking outside", () => {
    render(
      <ThemeProvider defaultTheme="dark" storageKey="worship-theme">
        <div>
          <span data-testid="outside-area">Outside</span>
          <ThemeMenuButton />
        </div>
      </ThemeProvider>,
    );

    const button = screen.getByTestId("theme-menu-button");
    fireEvent.click(button);
    expect(screen.getByTestId("theme-menu-dropdown")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside-area"));
    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
  });

  it("should close dropdown when pressing Escape key", () => {
    render(
      <ThemeProvider defaultTheme="dark" storageKey="worship-theme">
        <ThemeMenuButton />
      </ThemeProvider>,
    );

    const button = screen.getByTestId("theme-menu-button");
    fireEvent.click(button);
    expect(screen.getByTestId("theme-menu-dropdown")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
  });
});
