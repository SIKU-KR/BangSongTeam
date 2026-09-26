import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserSupportBanner } from "./BrowserSupportBanner";
import * as capabilities from "../../lib/browser/capabilities";

const FULLSCREEN = capabilities.BROWSER_CAPABILITIES.find(
  ({ id }) => id === "fullscreen",
)!;

describe("BrowserSupportBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("송출에 필요한 기능이 빠지면 빠진 기능을 알린다", () => {
    vi.spyOn(capabilities, "getMissingCapabilities").mockReturnValue([
      FULLSCREEN,
    ]);

    render(<BrowserSupportBanner />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/전체화면 송출/)).toBeInTheDocument();
  });

  it("기능이 모두 있으면 브라우저 이름과 상관없이 띄우지 않는다", () => {
    vi.spyOn(capabilities, "getMissingCapabilities").mockReturnValue([]);
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      configurable: true,
    });

    render(<BrowserSupportBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("닫으면 숨기고 닫은 상태를 기억한다", () => {
    vi.spyOn(capabilities, "getMissingCapabilities").mockReturnValue([
      FULLSCREEN,
    ]);

    render(<BrowserSupportBanner />);
    fireEvent.click(screen.getByRole("button", { name: /닫기/ }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(localStorage.getItem("dismiss_browser_support_warning")).toBe(
      "true",
    );
  });

  it("전에 닫았으면 띄우지 않는다", () => {
    localStorage.setItem("dismiss_browser_support_warning", "true");
    vi.spyOn(capabilities, "getMissingCapabilities").mockReturnValue([
      FULLSCREEN,
    ]);

    render(<BrowserSupportBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
