import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "./theme-provider";

const STORAGE_KEY = "test-theme";
const windowStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
const globalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

function blockStorage(): void {
  const denied: PropertyDescriptor = {
    configurable: true,
    get: () => {
      throw new DOMException("denied", "SecurityError");
    },
  };
  Object.defineProperty(window, "localStorage", denied);
  Object.defineProperty(globalThis, "localStorage", denied);
}

function Probe(): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme("dark")}>
      {theme}
    </button>
  );
}

function renderProbe(): void {
  render(
    <ThemeProvider defaultTheme="system" storageKey={STORAGE_KEY}>
      <Probe />
    </ThemeProvider>,
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
  });

  afterEach(() => {
    if (windowStorage) {
      Object.defineProperty(window, "localStorage", windowStorage);
    }
    if (globalStorage) {
      Object.defineProperty(globalThis, "localStorage", globalStorage);
    }
  });

  it("저장한 테마로 시작하고, 바꾼 테마를 저장한다", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    renderProbe();

    fireEvent.click(screen.getByRole("button", { name: "light" }));

    expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("사이트 저장소가 막혀 있어도 기본 테마로 그리고 테마를 바꿀 수 있다", () => {
    blockStorage();

    renderProbe();
    fireEvent.click(screen.getByRole("button", { name: "system" }));

    expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dark");
  });
});
