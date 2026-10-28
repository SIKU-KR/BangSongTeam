import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { compile } from "tailwindcss";
import { DEFAULT_DECK_STYLE, type Slide } from "#shared";
import { EditorStageCanvas } from "./EditorStageCanvas";

const SLIDE: Slide = { id: "s-1", order: 0, lines: ["가사 한 줄"] };

function renderCanvas(position: { slideNumber: number; total: number }) {
  render(
    <EditorStageCanvas
      slide={SLIDE}
      style={DEFAULT_DECK_STYLE}
      slideNumber={position.slideNumber}
      totalSlideCount={position.total}
      songNumber={1}
      totalSongs={1}
      onPrevSlide={vi.fn()}
      onNextSlide={vi.fn()}
    />,
  );
}

async function navCss(element: HTMLElement): Promise<string> {
  const compiler = await compile(
    "@theme { --spacing: 0.25rem; } @tailwind utilities;",
  );
  return compiler.build(
    element.className
      .split(/\s+/)
      .filter((name) =>
        /opacity|size-|^left-|^right-|:left-|:right-/.test(name),
      ),
  );
}

function touchRules(css: string): string {
  return css.match(/@media \(hover: ?none\) \{[\s\S]*?\n\}/g)?.join("\n") ?? "";
}

describe("EditorStageCanvas 이전·다음 버튼", () => {
  it("hover가 되는 기기에서는 슬라이드에 마우스를 올릴 때만 보인다", async () => {
    renderCanvas({ slideNumber: 2, total: 3 });

    for (const testId of ["canvas-prev-btn", "canvas-next-btn"]) {
      const css = await navCss(screen.getByTestId(testId));

      expect(css).toMatch(/\.opacity-0 \{\s*opacity: 0%/);
      expect(css).toMatch(
        /@media \(hover: hover\) \{[^}]*group-hover[^}]*\{\s*opacity: 100%/,
      );
    }
  });

  it("hover가 없는 터치 기기에서는 줄어든 불투명도로 늘 보인다", async () => {
    renderCanvas({ slideNumber: 2, total: 3 });

    for (const testId of ["canvas-prev-btn", "canvas-next-btn"]) {
      const css = await navCss(screen.getByTestId(testId));

      expect(touchRules(css)).toMatch(/opacity: 70%/);
    }
  });

  it("터치 기기에서도 누르는 영역이 44px(size-11) 이상이다", async () => {
    renderCanvas({ slideNumber: 2, total: 3 });

    for (const testId of ["canvas-prev-btn", "canvas-next-btn"]) {
      const css = await navCss(screen.getByTestId(testId));

      expect(touchRules(css)).toMatch(/width: calc\(var\(--spacing\) \* 11\)/);
      expect(touchRules(css)).toMatch(/height: calc\(var\(--spacing\) \* 11\)/);
    }
  });

  it("터치 기기에서는 가사를 덜 가리도록 슬라이드 가장자리에 더 바짝 붙인다", async () => {
    renderCanvas({ slideNumber: 2, total: 3 });

    const prevCss = await navCss(screen.getByTestId("canvas-prev-btn"));
    const nextCss = await navCss(screen.getByTestId("canvas-next-btn"));

    expect(prevCss).toMatch(
      /\.left-3 \{\s*left: calc\(var\(--spacing\) \* 3\)/,
    );
    expect(touchRules(prevCss)).toMatch(/left: var\(--spacing\)/);
    expect(nextCss).toMatch(
      /\.right-3 \{\s*right: calc\(var\(--spacing\) \* 3\)/,
    );
    expect(touchRules(nextCss)).toMatch(/right: var\(--spacing\)/);
  });

  it("처음 슬라이드의 이전 버튼과 마지막 슬라이드의 다음 버튼은 터치 기기에서도 가려 둔다", async () => {
    renderCanvas({ slideNumber: 1, total: 1 });

    for (const testId of ["canvas-prev-btn", "canvas-next-btn"]) {
      const button = screen.getByTestId(testId);
      const css = await navCss(button);

      expect(button).toBeDisabled();
      expect(css).toMatch(/\.disabled\\:opacity-0:disabled \{\s*opacity: 0%/);
    }
  });
});
