import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_DECK_STYLE } from "#shared";
import type { DeckStyle } from "#shared";
import { SongPropertyPanel } from "./SongPropertyPanel";

function renderPanel(style: DeckStyle = DEFAULT_DECK_STYLE) {
  const onUpdateStyle = vi.fn();
  render(
    <SongPropertyPanel
      style={style}
      onUpdateStyle={onUpdateStyle}
      onUpdateBackground={vi.fn()}
    />,
  );
  return { onUpdateStyle };
}

describe("SongPropertyPanel 3×3 기준점", () => {
  it("9개 버튼이 한국어 접근성 이름과 툴팁을 가진다", () => {
    renderPanel();
    const group = screen.getByRole("group", {
      name: "3×3 화면 기준점 (Anchor)",
    });
    const buttons = within(group).getAllByRole("button");

    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "좌측 상단",
      "가운데 상단",
      "우측 상단",
      "좌측 중앙",
      "가운데 중앙",
      "우측 중앙",
      "좌측 하단",
      "가운데 하단",
      "우측 하단",
    ]);
    for (const button of buttons) {
      expect(button).toHaveAttribute(
        "title",
        button.getAttribute("aria-label"),
      );
    }
  });

  it("선택된 위치만 aria-pressed=true로 노출한다", () => {
    renderPanel({
      ...DEFAULT_DECK_STYLE,
      position: {
        anchor: "bottom-right",
        xPercent: 90,
        yPercent: 90,
        widthPercent: 80,
      },
    });

    expect(screen.getByRole("button", { name: "우측 하단" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen
        .getAllByRole("button", { pressed: true })
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["우측 하단"]);
  });

  it("한국어 이름으로 찾은 버튼을 누르면 해당 기준점으로 갱신한다", () => {
    const { onUpdateStyle } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "가운데 하단" }));

    expect(onUpdateStyle).toHaveBeenCalledWith(
      expect.objectContaining({
        position: expect.objectContaining({ anchor: "bottom-center" }),
      }),
    );
  });
});
