import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { App } from "./App";

describe("App Route Integration", () => {
  it("should render HomeRoute when navigating to '/'", () => {
    window.history.pushState({}, "Home", "/");
    render(<App />);

    expect(screen.getByText(/Worship Slide/i)).toBeInTheDocument();
    expect(screen.getByTestId("start-present-btn")).toBeInTheDocument();
  });

  it("should render FullscreenPresentRoute when navigating to '/present/fullscreen'", () => {
    window.history.pushState({}, "Presentation", "/present/fullscreen");
    render(<App />);

    expect(screen.getByTestId("fullscreen-present-route")).toBeInTheDocument();
    expect(screen.getByText("시작됐네 우리 주님의 능력이")).toBeInTheDocument();
  });
});
