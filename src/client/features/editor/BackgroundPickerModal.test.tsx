import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BackgroundPickerModal } from "./BackgroundPickerModal";
import {
  resetBackgroundCatalogForTests,
  setBackgroundCatalogForTests,
} from "../backgrounds/backgroundCatalog";
import {
  makeBackground,
  TEST_SERVICE_BACKGROUNDS,
} from "../../test/backgroundFixture";

const { refreshBackgroundCatalog } = vi.hoisted(() => ({
  refreshBackgroundCatalog: vi.fn(async () => undefined),
}));

vi.mock("../../lib/sync/backgroundSync", () => ({ refreshBackgroundCatalog }));

const WARM = makeBackground(6, { title: "따뜻한 노을", tags: ["따뜻한"] });
const STILL = makeBackground(7, {
  title: "본당 이미지",
  kind: "image",
  mediaUrl: "/api/media/stills/7.png",
  posterUrl: "/api/media/stills/7.png",
});

function renderPicker(
  props: Partial<React.ComponentProps<typeof BackgroundPickerModal>> = {},
) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <BackgroundPickerModal
        isOpen
        onClose={onClose}
        onSelect={onSelect}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onSelect, onClose };
}

describe("BackgroundPickerModal", () => {
  beforeEach(() => {
    refreshBackgroundCatalog.mockClear();
    setBackgroundCatalogForTests([...TEST_SERVICE_BACKGROUNDS, WARM, STILL]);
  });

  it("닫혀 있으면 아무것도 그리지 않는다", () => {
    const { container } = render(
      <BackgroundPickerModal
        isOpen={false}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("열 때 서버 목록을 새로 받고, 고르면 적용한 뒤 닫는다", () => {
    const { onSelect, onClose } = renderPicker({
      selectedBackgroundId: TEST_SERVICE_BACKGROUNDS[0].id,
    });

    expect(refreshBackgroundCatalog).toHaveBeenCalledTimes(1);
    expect(screen.getByText("곡 배경 선택")).toBeInTheDocument();
    expect(
      screen.getByTestId(`bg-item-${TEST_SERVICE_BACKGROUNDS[0].id}`),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(
      screen.getByTestId(`bg-item-${TEST_SERVICE_BACKGROUNDS[1].id}`),
    );

    expect(onSelect).toHaveBeenCalledWith(TEST_SERVICE_BACKGROUNDS[1].id);
    expect(onClose).toHaveBeenCalled();
  });

  it("'배경 없음'으로 곡의 배경을 뺄 수 있다", () => {
    const { onSelect } = renderPicker({
      selectedBackgroundId: TEST_SERVICE_BACKGROUNDS[0].id,
    });

    fireEvent.click(screen.getByTestId("bg-item-none"));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("태그로 거른다", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "따뜻한" }));

    expect(screen.getByText("따뜻한 노을")).toBeInTheDocument();
    expect(screen.queryByText(TEST_SERVICE_BACKGROUNDS[0].title)).toBeNull();
  });

  it("탭 없이 모든 배경을 한 격자에 보여 주고 영상·이미지를 함께 고른다", () => {
    const { onSelect } = renderPicker({ selectedBackgroundId: STILL.id });

    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("본당 이미지")).toBeInTheDocument();
    expect(
      screen.getByText(TEST_SERVICE_BACKGROUNDS[0].title),
    ).toBeInTheDocument();
    expect(screen.getByTestId(`bg-item-${STILL.id}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByTestId(`bg-item-${WARM.id}`));
    expect(onSelect).toHaveBeenCalledWith(WARM.id);
  });

  it("배경이 하나도 없으면 빈 상태를 보여 준다", () => {
    resetBackgroundCatalogForTests();
    renderPicker();

    expect(
      screen.getByText("아직 등록된 배경이 없습니다."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("bg-item-none")).toBeInTheDocument();
  });
});
