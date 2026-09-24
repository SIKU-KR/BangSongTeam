import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChromeAlertBanner } from "./ChromeAlertBanner";

describe("ChromeAlertBanner Component", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("should display the banner when accessed via non-Chrome browser (e.g. Safari)", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      configurable: true,
    });

    render(<ChromeAlertBanner />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Google Chrome/)).toBeInTheDocument();
  });

  it("should display the banner when accessed via Microsoft Edge via userAgentData", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: {
        brands: [
          { brand: "Chromium", version: "120" },
          { brand: "Microsoft Edge", version: "120" },
        ],
      },
      configurable: true,
    });

    render(<ChromeAlertBanner />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("should NOT display the banner when accessed via Google Chrome", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: {
        brands: [
          { brand: "Chromium", version: "120" },
          { brand: "Google Chrome", version: "120" },
        ],
      },
      configurable: true,
    });

    render(<ChromeAlertBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("should hide the banner and persist dismissal to localStorage when close button is clicked", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
      configurable: true,
    });

    render(<ChromeAlertBanner />);
    const closeBtn = screen.getByRole("button", { name: /닫기/ });
    expect(closeBtn).toBeInTheDocument();

    fireEvent.click(closeBtn);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(localStorage.getItem("dismiss_chrome_warning")).toBe("true");
  });

  it("should NOT display the banner if previously dismissed in localStorage", () => {
    localStorage.setItem("dismiss_chrome_warning", "true");

    Object.defineProperty(navigator, "userAgentData", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
      configurable: true,
    });

    render(<ChromeAlertBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
