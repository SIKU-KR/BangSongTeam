import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_DECK_STYLE } from "#shared";
import type { DeckStyle } from "#shared";
import {
  SongPropertyPanel,
  type SongOverflowWarnings,
} from "./SongPropertyPanel";

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

function renderPanelWithWarnings(overflowWarnings: SongOverflowWarnings) {
  render(
    <SongPropertyPanel
      style={DEFAULT_DECK_STYLE}
      onUpdateStyle={vi.fn()}
      onUpdateBackground={vi.fn()}
      overflowWarnings={overflowWarnings}
    />,
  );
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

describe("SongPropertyPanel 넘침 경고", () => {
  it("넘침이 없으면 경고를 숨긴다", () => {
    renderPanelWithWarnings({ activeSlideWraps: false, exceedsStage: false });

    expect(
      screen.queryByTestId("overflow-warning-panel"),
    ).not.toBeInTheDocument();
  });

  it("곡 넘침과 현재 슬라이드 줄바꿈을 각각 안내한다", () => {
    renderPanelWithWarnings({ activeSlideWraps: true, exceedsStage: true });

    const warning = screen.getByTestId("overflow-warning-panel");
    expect(warning).toHaveTextContent(
      "가장 긴 슬라이드가 화면 가장자리 여백을 넘칩니다",
    );
    expect(warning).toHaveTextContent(
      "텍스트 박스 폭을 넘어 자동 줄바꿈됩니다",
    );
  });

  it("현재 슬라이드만 줄바꿈되면 그 안내만 보여 준다", () => {
    renderPanelWithWarnings({ activeSlideWraps: true, exceedsStage: false });

    const warning = screen.getByTestId("overflow-warning-panel");
    expect(warning).not.toHaveTextContent("화면 가장자리 여백을 넘칩니다");
    expect(warning).toHaveTextContent("자동 줄바꿈");
  });
});
