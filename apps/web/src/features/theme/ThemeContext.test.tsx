import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { ThemeProvider, useTheme, resetThemeForTesting } from "./ThemeContext";

function TestConsumer(): React.JSX.Element {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-val">{theme}</span>
      <span data-testid="resolved-val">{resolvedTheme}</span>
      <button data-testid="set-light" onClick={() => setTheme("light")}>
        Light
      </button>
      <button data-testid="set-dark" onClick={() => setTheme("dark")}>
        Dark
      </button>
      <button data-testid="set-system" onClick={() => setTheme("system")}>
        System
      </button>
    </div>
  );
}

describe("ThemeContext & useTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    resetThemeForTesting("system");
  });

  it("should initialize with defaultTheme if provided", () => {
    render(
      <ThemeProvider defaultTheme="light">
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme-val").textContent).toBe("light");
    expect(screen.getByTestId("resolved-val").textContent).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("should initialize with stored theme from localStorage", () => {
    window.localStorage.setItem("worship-theme", "dark");
    resetThemeForTesting();

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme-val").textContent).toBe("dark");
    expect(screen.getByTestId("resolved-val").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("should switch theme to light, update document classes and persist to localStorage", () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => {
      screen.getByTestId("set-light").click();
    });

    expect(screen.getByTestId("theme-val").textContent).toBe("light");
    expect(screen.getByTestId("resolved-val").textContent).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("worship-theme")).toBe("light");
  });

  it("should switch theme to dark, update document classes and persist to localStorage", () => {
    render(
      <ThemeProvider defaultTheme="light">
        <TestConsumer />
      </ThemeProvider>,
    );

    act(() => {
      screen.getByTestId("set-dark").click();
    });

    expect(screen.getByTestId("theme-val").textContent).toBe("dark");
    expect(screen.getByTestId("resolved-val").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(window.localStorage.getItem("worship-theme")).toBe("dark");
  });

  it("should switch theme to system mode", () => {
    render(
      <ThemeProvider defaultTheme="light">
        <TestConsumer />
      </ThemeProvider>,
    );

    act(() => {
      screen.getByTestId("set-system").click();
    });

    expect(screen.getByTestId("theme-val").textContent).toBe("system");
    expect(window.localStorage.getItem("worship-theme")).toBe("system");
  });

  it("should return safe fallback defaults when useTheme is called outside ThemeProvider", () => {
    resetThemeForTesting("system");
    render(<TestConsumer />);
    expect(screen.getByTestId("theme-val").textContent).toBe("system");
    expect(screen.getByTestId("resolved-val").textContent).toBe("light");
  });
});
