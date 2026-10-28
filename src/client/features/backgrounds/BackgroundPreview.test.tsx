import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { makeBackground } from "../../test/backgroundFixture";
import { resetFakeCacheStorage } from "../../test/fakeCacheStorage";
import { __resetMediaCachingForTests } from "../../lib/offline/mediaCache";
import { BackgroundPreview } from "./BackgroundPreview";

const BACKGROUND = makeBackground(1);

function poster(): HTMLElement | undefined {
  return screen
    .queryAllByRole("img", { name: BACKGROUND.title })
    .find((element) => element.tagName === "IMG");
}

describe("BackgroundPreview", () => {
  beforeEach(() => {
    resetFakeCacheStorage();
    __resetMediaCachingForTests();
  });

  it("포스터를 불러오지 못했으면 다시 연결될 때 다시 불러온다", () => {
    render(<BackgroundPreview background={BACKGROUND} />);
    const image = poster();
    expect(image).toBeDefined();

    fireEvent.error(image as HTMLElement);
    expect(
      screen.getByTestId(`bg-preview-missing-${BACKGROUND.id}`),
    ).toBeInTheDocument();
    expect(poster()).toBeUndefined();

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(
      screen.queryByTestId(`bg-preview-missing-${BACKGROUND.id}`),
    ).toBeNull();
    expect(poster()).toHaveAttribute("src", BACKGROUND.posterUrl);
  });
});
