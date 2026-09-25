import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FontControls } from "./FontControls";
import { DEFAULT_DECK_STYLE, loadNoonnuFontCatalog } from "#shared";

describe("FontControls (글꼴 컨트롤)", () => {
  it("카탈로그의 모든 웹폰트는 비어있지 않은 유효한 URL을 갖는다", async () => {
    const NOONNU_FONTS = await loadNoonnuFontCatalog();
    expect(NOONNU_FONTS.length).toBeGreaterThan(1100);
    const withoutUrl = NOONNU_FONTS.filter(
      (f) => !f.url || f.url.trim() === "",
    );
    expect(withoutUrl).toHaveLength(0);
  });

  it("글꼴 선택 드롭다운을 열면 글꼴 목록 항목에 해당 폰트 스타일이 렌더링되어 출력된다", async () => {
    const onUpdateStyle = vi.fn();
    render(
      <FontControls
        style={DEFAULT_DECK_STYLE}
        disabled={false}
        onUpdateStyle={onUpdateStyle}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "글꼴" }));

    const pretOption = await screen.findByRole("option", {
      name: "Pretendard",
    });
    expect(pretOption).toBeInTheDocument();
    expect(pretOption.style.fontFamily).toContain("Pretendard");

    const gmarketOption = await screen.findByRole("option", {
      name: "Gmarket Sans",
    });
    expect(gmarketOption).toBeInTheDocument();
    expect(gmarketOption.style.fontFamily).toContain("Gmarket Sans");

    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThan(10),
    );
    const items = screen.getAllByRole("option");
    for (const item of items) {
      expect(item.style.fontFamily).toBeTruthy();
    }
  });

  it("글꼴 검색창에 입력하면 매칭되는 눈누 웹폰트 목록이 필터링되어 출력된다", async () => {
    const onUpdateStyle = vi.fn();
    render(
      <FontControls
        style={DEFAULT_DECK_STYLE}
        disabled={false}
        onUpdateStyle={onUpdateStyle}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "글꼴" }));

    const searchInput =
      await screen.findByPlaceholderText("글꼴 검색 (1,100+종)...");
    fireEvent.change(searchInput, { target: { value: "페이퍼로지" } });

    const paperOption = await screen.findByRole("option", {
      name: "페이퍼로지",
    });
    expect(paperOption).toBeInTheDocument();
    expect(paperOption.style.fontFamily).toContain("페이퍼로지");

    fireEvent.pointerDown(paperOption);
    fireEvent.mouseDown(paperOption);
    fireEvent.pointerUp(paperOption);
    fireEvent.click(paperOption);

    expect(onUpdateStyle).toHaveBeenCalledWith({ fontFamily: "페이퍼로지" });
  });
});
