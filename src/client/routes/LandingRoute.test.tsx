import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { MemoryRouter, Routes, Route } from "../test/router";
import { signInAsTestUser, signOutForTests } from "../test/sessionFixture";
import { LandingRoute } from "./LandingRoute";
import { APP_NAME, APP_TAGLINE } from "#shared";

function renderLanding(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
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
  afterEach(() => signOutForTests());

  it("랜딩 플레이스홀더를 렌더한다", () => {
    renderLanding();

    expect(screen.getByTestId("landing-route")).toBeInTheDocument();
    expect(screen.getByText(APP_NAME)).toBeInTheDocument();
    expect(screen.getByText(APP_TAGLINE)).toBeInTheDocument();
  });

  it("진입 버튼은 /presentations 로 이동한다", () => {
    renderLanding();

    fireEvent.click(screen.getByTestId("landing-enter-btn"));

    expect(screen.getByTestId("presentations-stub")).toBeInTheDocument();
  });

  describe("소셜 로그인 실패로 서버가 /?error=코드로 돌려보냈을 때", () => {
    it("랜딩을 보여 주지 않고 오류 코드를 가진 채 로그인 화면이 열리는 주소로 보낸다", () => {
      renderLanding("/?error=account_not_linked");

      expect(screen.getByTestId("presentations-stub")).toBeInTheDocument();
      expect(screen.queryByTestId("landing-route")).toBeNull();
      expect(window.location.pathname).toBe("/presentations");
      expect(window.location.search).toBe("?error=account_not_linked");
    });

    it("이미 로그인한 사람에게는 안내할 로그인 화면이 없으니 오류 코드 없이 드라이브로 보낸다", () => {
      signInAsTestUser();

      renderLanding("/?error=account_not_linked");

      expect(screen.getByTestId("presentations-stub")).toBeInTheDocument();
      expect(screen.queryByTestId("landing-route")).toBeNull();
      expect(window.location.pathname).toBe("/presentations");
      expect(window.location.search).toBe("");
    });

    it("제공자가 붙인 오류 설명은 넘기지 않는다", () => {
      renderLanding(
        "/?error=access_denied&error_description=The+user+denied+access",
      );

      expect(window.location.pathname).toBe("/presentations");
      expect(window.location.search).toBe("?error=access_denied");
    });

    it.each(["/?utm_source=church", "/?error="])(
      "오류 코드가 없는 %s는 랜딩을 그대로 보여 준다",
      (path) => {
        renderLanding(path);

        expect(screen.getByTestId("landing-route")).toBeInTheDocument();
        expect(window.location.pathname).toBe("/");
      },
    );
  });
});
