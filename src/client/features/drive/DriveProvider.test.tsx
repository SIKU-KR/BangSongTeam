import React, { useLayoutEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testRouter } from "../../test/next/navigation";
import { DriveProvider } from "./DriveProvider";
import { useDrive } from "./driveContext";
import { itemKey } from "./driveModel";

const KEY = itemKey("file", "a00000000000000000001");

function SelectOnCommit(): null {
  const { setSelection } = useDrive();
  useLayoutEffect(() => {
    setSelection([KEY], KEY);
  }, [setSelection]);
  return null;
}

function SelectButton(): React.JSX.Element {
  const { setSelection } = useDrive();
  return (
    <button type="button" onClick={() => setSelection([KEY], KEY)}>
      select
    </button>
  );
}

function SelectionView(): React.JSX.Element {
  const { selection, anchorKey, focusKey } = useDrive();
  return (
    <output data-testid="selection">
      {[...selection].join(",")}|{anchorKey ?? ""}|{focusKey ?? ""}
    </output>
  );
}

describe("DriveProvider 선택", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/presentations");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("마운트하는 커밋에서 고른 항목은 마운트 뒤에 도는 효과가 지우지 않는다", () => {
    render(
      <DriveProvider>
        <SelectOnCommit />
        <SelectionView />
      </DriveProvider>,
    );

    expect(screen.getByTestId("selection")).toHaveTextContent(
      `${KEY}|${KEY}|${KEY}`,
    );
  });

  it("주소가 바뀌면 선택과 기준점, 포커스를 비운다", () => {
    render(
      <DriveProvider>
        <SelectButton />
        <SelectionView />
      </DriveProvider>,
    );
    act(() => {
      screen.getByRole("button", { name: "select" }).click();
    });
    expect(screen.getByTestId("selection")).toHaveTextContent(
      `${KEY}|${KEY}|${KEY}`,
    );

    act(() => {
      testRouter.push("/presentations/trash");
    });

    expect(screen.getByTestId("selection").textContent).toBe("||");
  });
});
