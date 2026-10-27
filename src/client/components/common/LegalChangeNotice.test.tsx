import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LegalChangeNotice } from "./LegalChangeNotice";
import { LEGAL_COPY, LEGAL_EFFECTIVE_DATE } from "#copy/auth";

const BEFORE = new Date("2026-11-02T23:59:00+09:00");
const EFFECTIVE = new Date("2026-11-03T00:00:00+09:00");

function notice(): HTMLElement | null {
  return screen.queryByTestId("legal-change-notice");
}

describe("LegalChangeNotice", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("시행일 전에는 바뀐다는 안내와 두 글로 가는 링크를 보여 준다", () => {
    vi.setSystemTime(BEFORE);

    render(<LegalChangeNotice />);

    expect(notice()).toHaveTextContent(
      LEGAL_COPY.change.title(LEGAL_EFFECTIVE_DATE),
    );
    expect(
      screen.getByRole("link", { name: LEGAL_COPY.terms }),
    ).toHaveAttribute("href", "/terms");
    expect(
      screen.getByRole("link", { name: LEGAL_COPY.privacy }),
    ).toHaveAttribute("href", "/privacy");
  });

  it("시행일부터는 띄우지 않는다", () => {
    vi.setSystemTime(EFFECTIVE);

    render(<LegalChangeNotice />);

    expect(notice()).toBeNull();
  });

  it("닫으면 숨기고, 다시 열어도 같은 시행일의 안내는 띄우지 않는다", () => {
    vi.setSystemTime(BEFORE);
    const { unmount } = render(<LegalChangeNotice />);

    fireEvent.click(
      screen.getByRole("button", { name: LEGAL_COPY.change.dismiss }),
    );
    expect(notice()).toBeNull();

    unmount();
    render(<LegalChangeNotice />);
    expect(notice()).toBeNull();
  });

  it("브라우저 저장소를 쓸 수 없어도 안내를 띄우고 닫을 수 있다", () => {
    vi.setSystemTime(BEFORE);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });

    render(<LegalChangeNotice />);
    expect(notice()).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: LEGAL_COPY.change.dismiss }),
    );
    expect(notice()).toBeNull();
  });
});
