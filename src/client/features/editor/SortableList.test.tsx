import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { resolveReorder, SortableList, SortableItem } from "./SortableList";

describe("resolveReorder", () => {
  const ids = ["a", "b", "c", "d"];

  it("active/over 아이디를 from/to 인덱스로 변환한다", () => {
    expect(resolveReorder(ids, "a", "c")).toEqual({ from: 0, to: 2 });
    expect(resolveReorder(ids, "d", "b")).toEqual({ from: 3, to: 1 });
  });

  it("over가 없거나 같은 위치면 null", () => {
    expect(resolveReorder(ids, "a", null)).toBeNull();
    expect(resolveReorder(ids, "a", "a")).toBeNull();
  });

  it("목록에 없는 아이디면 null", () => {
    expect(resolveReorder(ids, "x", "a")).toBeNull();
    expect(resolveReorder(ids, "a", "x")).toBeNull();
  });
});

describe("SortableList / SortableItem", () => {
  it("자식 아이템을 렌더링하고 data-testid와 클래스를 전달한다", () => {
    render(
      <SortableList ids={["a", "b"]} onReorder={() => {}}>
        <SortableItem sortableId="a" data-testid="item-a" className="foo">
          A
        </SortableItem>
        <SortableItem sortableId="b" data-testid="item-b">
          B
        </SortableItem>
      </SortableList>,
    );
    const a = screen.getByTestId("item-a");
    expect(a.textContent).toBe("A");
    expect(a.className).toContain("foo");
    expect(screen.getByTestId("item-b").textContent).toBe("B");
  });
});
