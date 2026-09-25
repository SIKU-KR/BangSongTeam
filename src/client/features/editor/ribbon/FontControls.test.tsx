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

  it("글꼴 목록은 폰트 파일 대신 미리 그려 둔 이름 이미지로 보여 준다", async () => {
    render(
      <FontControls
        style={DEFAULT_DECK_STYLE}
        disabled={false}
        onUpdateStyle={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "글꼴" }));

    const gmarketOption = await screen.findByRole("option", {
      name: "Gmarket Sans",
    });
    const preview = gmarketOption.querySelector<HTMLElement>(
      "[aria-hidden='true']",
    );
    expect(preview?.style.maskImage).toContain(
      "/font-previews/core-gmarket-sans.webp",
    );

    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThan(10),
    );
    const items = screen.getAllByRole("option");
    for (const item of items) {
      expect(item.style.fontFamily).toBe("");
    }
  });

  it("편집기를 열고 글꼴 목록을 펼쳐도 사용 중인 글꼴만 불러온다", async () => {
    const before = new Set(document.querySelectorAll("[data-noonnu-font-id]"));
    render(
      <FontControls
        style={{ ...DEFAULT_DECK_STYLE, fontFamily: "고운바탕" }}
        disabled={false}
        onUpdateStyle={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "글꼴" }));
    await screen.findByRole("option", { name: "Gmarket Sans" });

    const injected = [
      ...document.querySelectorAll("[data-noonnu-font-id]"),
    ].filter((el) => !before.has(el));
    expect(
      injected.map((el) => el.getAttribute("data-noonnu-font-id")),
    ).toEqual(["733"]);
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

    fireEvent.pointerDown(paperOption);
    fireEvent.mouseDown(paperOption);
    fireEvent.pointerUp(paperOption);
    fireEvent.click(paperOption);

    expect(onUpdateStyle).toHaveBeenCalledWith({ fontFamily: "페이퍼로지" });
  });
});
