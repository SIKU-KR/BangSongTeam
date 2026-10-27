import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserSupportBanner } from "./BrowserSupportBanner";
import * as capabilities from "../../lib/browser/capabilities";
import { SHELL_COPY } from "#copy/shell";

const FULLSCREEN = capabilities.BROWSER_CAPABILITIES.find(
  ({ id }) => id === "fullscreen",
)!;

describe("BrowserSupportBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("색을 섞지 못하는 오래된 브라우저(Windows 7·8.1의 Chrome·Edge 109)", () => {
    beforeEach(() => {
      vi.spyOn(CSS, "supports").mockReturnValue(false);
    });

    it("송출 기능이 모두 있어도 업데이트하거나 다른 브라우저로 열라고 알린다", () => {
      vi.spyOn(capabilities, "getMissingCapabilities").mockReturnValue([]);

      render(<BrowserSupportBanner />);

      const banner = screen.getByRole("alert");
      expect(banner).toHaveTextContent(
        SHELL_COPY.browserSupport.outdated.title,
      );
      expect(banner).toHaveTextContent(
        SHELL_COPY.browserSupport.outdated.description,
      );
    });

    it("빠진 송출 기능이 있어도 업데이트 안내 하나만 보인다", () => {
      vi.spyOn(capabilities, "getMissingCapabilities").mockReturnValue([
        FULLSCREEN,
      ]);

      render(<BrowserSupportBanner />);

      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent(
        SHELL_COPY.browserSupport.outdated.title,
      );
    });

    it("닫으면 숨기고 다시 열어도 띄우지 않는다", () => {
      vi.spyOn(capabilities, "getMissingCapabilities").mockReturnValue([]);
      const { unmount } = render(<BrowserSupportBanner />);

      fireEvent.click(screen.getByRole("button", { name: /닫기/ }));
      expect(screen.queryByRole("alert")).toBeNull();

      unmount();
      render(<BrowserSupportBanner />);
      expect(screen.queryByRole("alert")).toBeNull();
    });
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
