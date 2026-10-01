import { describe, expect, it } from "vitest";
import {
  paneTargetAttrs,
  readPaneTarget,
  type PaneTarget,
} from "./slidePaneTargets";

const elementWith = (target: PaneTarget): HTMLElement => {
  const element = document.createElement("div");
  for (const [name, value] of Object.entries(paneTargetAttrs(target))) {
    element.setAttribute(name, String(value));
  }
  return element;
};

describe("paneTargetAttrs · readPaneTarget", () => {
  it.each<PaneTarget>([
    { kind: "slide", songIndex: 2, slideIndex: 4 },
    { kind: "gap", songIndex: 1, index: 0 },
    { kind: "header", songIndex: 3 },
  ])("$kind 대상을 속성으로 쓰고 안쪽 요소에서 다시 읽는다", (target) => {
    const element = elementWith(target);
    const inner = document.createElement("span");
    element.appendChild(inner);
    expect(readPaneTarget(inner)).toEqual(target);
  });

  it("썸네일·틈·머리글 순으로 가장 먼저 맞는 대상을 고른다", () => {
    const header = elementWith({ kind: "header", songIndex: 0 });
    const thumb = elementWith({ kind: "slide", songIndex: 0, slideIndex: 1 });
    header.appendChild(thumb);
    expect(readPaneTarget(thumb)).toEqual({
      kind: "slide",
      songIndex: 0,
      slideIndex: 1,
    });
  });

  it("대상 밖이면 null", () => {
    expect(readPaneTarget(document.createElement("div"))).toBeNull();
  });
});
