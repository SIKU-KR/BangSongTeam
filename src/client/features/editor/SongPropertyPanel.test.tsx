import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DEFAULT_DECK_STYLE } from "#shared";
import {
  SongPropertyPanel,
  type SongOverflowWarnings,
} from "./SongPropertyPanel";

function renderPanel(overflowWarnings?: SongOverflowWarnings) {
  return render(
    <SongPropertyPanel
      style={DEFAULT_DECK_STYLE}
      onUpdateStyle={vi.fn()}
      onUpdateBackground={vi.fn()}
      overflowWarnings={overflowWarnings}
    />,
  );
}

describe("SongPropertyPanel 넘침 경고", () => {
  it("넘침이 없으면 경고를 숨긴다", () => {
    renderPanel({ activeSlideWraps: false, exceedsStage: false });

    expect(
      screen.queryByTestId("overflow-warning-panel"),
    ).not.toBeInTheDocument();
  });

  it("곡 넘침과 현재 슬라이드 줄바꿈을 각각 안내한다", () => {
    renderPanel({ activeSlideWraps: true, exceedsStage: true });

    const warning = screen.getByTestId("overflow-warning-panel");
    expect(warning).toHaveTextContent(
      "가장 긴 슬라이드가 화면 가장자리 여백을 넘칩니다",
    );
    expect(warning).toHaveTextContent(
      "텍스트 박스 폭을 넘어 자동 줄바꿈됩니다",
    );
  });

  it("현재 슬라이드만 줄바꿈되면 그 안내만 보여 준다", () => {
    renderPanel({ activeSlideWraps: true, exceedsStage: false });

    const warning = screen.getByTestId("overflow-warning-panel");
    expect(warning).not.toHaveTextContent("화면 가장자리 여백을 넘칩니다");
    expect(warning).toHaveTextContent("자동 줄바꿈");
  });
});
