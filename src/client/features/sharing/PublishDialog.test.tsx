import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublishDialog } from "./PublishDialog";

function renderDialog(usesPrivateBackground: boolean) {
  render(
    <PublishDialog
      isOpen
      songTitle="은혜로다"
      overwritesLibraryCopy={false}
      usesPrivateBackground={usesPrivateBackground}
      isPending={false}
      error={null}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe("PublishDialog", () => {
  it("내가 올린 배경을 쓰는 곡이면 다른 사람에게는 배경 없이 보인다고 알린다", () => {
    renderDialog(true);
    expect(
      screen.getByTestId("publish-private-background-note"),
    ).toHaveTextContent("배경 없이 보입니다");
  });

  it("기본 제공 배경이면 따로 알리지 않는다", () => {
    renderDialog(false);
    expect(
      screen.queryByTestId("publish-private-background-note"),
    ).not.toBeInTheDocument();
  });
});
