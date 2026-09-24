import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { LandingRoute } from "./LandingRoute";

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<LandingRoute />} />
        <Route
          path="/presentations"
          element={<div data-testid="presentations-stub" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LandingRoute", () => {
  it("랜딩 플레이스홀더를 렌더한다", () => {
    renderLanding();

    expect(screen.getByTestId("landing-route")).toBeInTheDocument();
    expect(screen.getByText("Worship Studio")).toBeInTheDocument();
    expect(screen.getByText("랜딩 페이지 준비 중입니다.")).toBeInTheDocument();
  });

  it("진입 버튼은 /presentations 로 이동한다", () => {
    renderLanding();

    fireEvent.click(screen.getByTestId("landing-enter-btn"));

    expect(screen.getByTestId("presentations-stub")).toBeInTheDocument();
  });
});
