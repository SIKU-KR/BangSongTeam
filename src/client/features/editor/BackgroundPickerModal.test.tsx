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
const MINE = makeBackground(7, {
  title: "본당 이미지",
  source: "user",
  kind: "image",
  mediaUrl: "/api/media/uploads/u/7.png",
  posterUrl: "/api/media/uploads/u/7.png",
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
    setBackgroundCatalogForTests([...TEST_SERVICE_BACKGROUNDS, WARM, MINE]);
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

  it("내 배경 탭에서 올린 배경을 고르고, 내 배경이 지정된 곡은 그 탭으로 열린다", () => {
    const { onSelect } = renderPicker({ selectedBackgroundId: MINE.id });

    expect(screen.getByRole("tab", { name: "내 배경" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("본당 이미지")).toBeInTheDocument();
    expect(screen.getByText("이미지")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`bg-item-${MINE.id}`));
    expect(onSelect).toHaveBeenCalledWith(MINE.id);
  });

  it("올린 배경이 없으면 배경 라이브러리로 안내한다", () => {
    setBackgroundCatalogForTests(TEST_SERVICE_BACKGROUNDS);
    renderPicker();

    fireEvent.click(screen.getByRole("tab", { name: "내 배경" }));

    expect(
      screen.getByRole("link", { name: "배경 라이브러리에서 올리기" }),
    ).toHaveAttribute("href", "/backgrounds");
  });

  it("기본 제공 배경이 하나도 없으면 빈 상태를 보여 준다", () => {
    resetBackgroundCatalogForTests();
    renderPicker();

    expect(
      screen.getByText("아직 제공되는 기본 배경이 없습니다."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("bg-item-none")).toBeInTheDocument();
  });
});
