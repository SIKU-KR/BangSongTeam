import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Slide } from "#shared";
import { StageLyricsEditor } from "./StageLyricsEditor";

const noop = (): void => undefined;

function slideOf(lines: string[]): Slide {
  return { id: "slide-1", order: 0, lines };
}

function editorFor(lines: string[]): React.JSX.Element {
  return (
    <StageLyricsEditor
      slide={slideOf(lines)}
      caretColor="#ffffff"
      onChangeLines={noop}
      onLimitHit={noop}
      onCaretChange={noop}
      onSplit={noop}
      onExit={noop}
    />
  );
}

const textarea = (): HTMLTextAreaElement =>
  screen.getByTestId("stage-lyrics-editor") as HTMLTextAreaElement;

describe("StageLyricsEditor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("줄 수만큼 행을 잡아, field-sizing을 모르는 브라우저에서도 모든 줄이 보인다", () => {
    const view = render(editorFor(["첫째", "둘째", "셋째", "넷째"]));
    expect(textarea().rows).toBe(4);

    view.rerender(editorFor(["첫째", "둘째"]));
    expect(textarea().rows).toBe(2);

    view.rerender(editorFor([]));
    expect(textarea().rows).toBe(1);
  });

  it("field-sizing을 모르는 브라우저에서는 감겨 늘어난 줄까지 내용 높이에 맞춘다", () => {
    const supports = vi.spyOn(CSS, "supports").mockReturnValue(false);
    let contentHeight = 300;
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(
      () => contentHeight,
    );

    const view = render(editorFor(["길게 감기는 첫째 줄", "둘째 줄"]));
    expect(supports).toHaveBeenCalledWith("field-sizing", "content");
    expect(textarea().style.height).toBe("300px");

    contentHeight = 168;
    view.rerender(editorFor(["길게 감기는 첫째 줄", "둘째 줄", "셋째 줄"]));
    expect(textarea().style.height).toBe("168px");
  });

  it("field-sizing을 아는 브라우저에서는 높이를 직접 정하지 않는다", () => {
    vi.spyOn(CSS, "supports").mockReturnValue(true);
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(300);

    render(editorFor(["첫째", "둘째"]));

    expect(textarea().style.height).toBe("");
  });

  it("CSS.supports가 없는 브라우저에서도 내용 높이에 맞춘다", () => {
    vi.stubGlobal("CSS", undefined);
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(120);

    render(editorFor(["첫째", "둘째"]));

    expect(textarea().style.height).toBe("120px");
  });

  it("높이를 잴 수 없으면 높이를 자동으로 둔다", () => {
    vi.spyOn(CSS, "supports").mockReturnValue(false);

    render(editorFor(["첫째", "둘째"]));

    expect(textarea().style.height).toBe("auto");
  });
});
