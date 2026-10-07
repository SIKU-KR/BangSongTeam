import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
import { mediaCacheNameFor } from "#shared";
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { resetFakeCacheStorage } from "../../test/fakeCacheStorage";
import { __resetMediaCachingForTests } from "../../lib/offline/mediaCache";
import { withQueryClient } from "../../test/queryClientFixture";
import { installFakeApi } from "../../test/fakeApi";

const { refreshBackgroundCatalog } = vi.hoisted(() => ({
  refreshBackgroundCatalog: vi.fn(async () => undefined),
}));

vi.mock("../../lib/sync/backgroundSync", () => ({ refreshBackgroundCatalog }));

const WARM = makeBackground(6, {
  title: "따뜻한 노을",
  keywords: ["주황색", "노을", "감사"],
});
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
    withQueryClient(
      <MemoryRouter>
        <BackgroundPickerModal
          isOpen
          onClose={onClose}
          onSelect={onSelect}
          {...props}
        />
      </MemoryRouter>,
    ),
  );
  return { onSelect, onClose };
}

describe("BackgroundPickerModal", () => {
  beforeEach(() => {
    refreshBackgroundCatalog.mockClear();
    resetFakeCacheStorage();
    __resetMediaCachingForTests();
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
    expect(screen.getByText(BACKGROUND_COPY.picker.title)).toBeInTheDocument();
    expect(
      screen.getByTestId(`bg-item-${TEST_SERVICE_BACKGROUNDS[0].id}`),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(
      screen.getByTestId(`bg-item-${TEST_SERVICE_BACKGROUNDS[1].id}`),
    );

    expect(onSelect).toHaveBeenCalledWith({
      backgroundId: TEST_SERVICE_BACKGROUNDS[1].id,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("단색 팔레트에서 색을 골라 배경 영상·이미지를 바꿀 수 있다", () => {
    const { onSelect, onClose } = renderPicker({
      selectedBackgroundId: TEST_SERVICE_BACKGROUNDS[0].id,
    });
    const palette = screen.getByTestId("bg-solid-palette");
    expect(within(palette).queryByRole("button", { pressed: true })).toBeNull();

    fireEvent.click(within(palette).getByRole("button", { name: "진한 파랑" }));

    expect(onSelect).toHaveBeenCalledWith({ color: "#002060" });
    expect(onClose).toHaveBeenCalled();
  });

  it("배경 영상·이미지가 없으면 곡의 단색을 선택해 둔다", () => {
    renderPicker({ selectedBackgroundId: null, selectedColor: "#c00000" });
    expect(
      within(screen.getByTestId("bg-solid-palette")).getByRole("button", {
        pressed: true,
      }),
    ).toHaveAccessibleName("진한 빨강");
  });

  it("검정은 단색을 고른 적 없는 곡의 기본값이다", () => {
    renderPicker({ selectedBackgroundId: null });
    expect(
      within(screen.getByTestId("bg-solid-palette")).getByRole("button", {
        pressed: true,
      }),
    ).toHaveAccessibleName("검정");
  });

  it("영상·이미지 종류로 거른다", () => {
    renderPicker();

    fireEvent.click(
      screen.getByRole("button", { name: BACKGROUND_COPY.image }),
    );

    expect(
      screen.getByRole("img", { name: "본당 이미지" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: TEST_SERVICE_BACKGROUNDS[0].title }),
    ).toBeNull();
  });

  it("탭 없이 모든 배경을 한 격자에 보여 주고 영상·이미지를 함께 고른다", () => {
    const { onSelect } = renderPicker({ selectedBackgroundId: STILL.id });

    expect(screen.queryByRole("tab")).toBeNull();
    expect(
      screen.getByRole("img", { name: "본당 이미지" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: TEST_SERVICE_BACKGROUNDS[0].title }),
    ).toBeInTheDocument();
    expect(screen.getByTestId(`bg-item-${STILL.id}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByTestId(`bg-item-${WARM.id}`));
    expect(onSelect).toHaveBeenCalledWith({ backgroundId: WARM.id });
  });

  it("검색어는 서버 벡터 검색으로 찾고, 맞는 배경이 없으면 알려 준다", async () => {
    const api = installFakeApi({
      "GET /api/backgrounds/search": ({ url }) => ({
        body: {
          results:
            url.searchParams.get("q") === "감사할 때 쓸 노을"
              ? [{ id: WARM.id, score: 0.7 }]
              : [],
        },
      }),
    });
    try {
      renderPicker();

      const input = screen.getByTestId("bg-picker-search-input");
      fireEvent.change(input, { target: { value: "감사할 때 쓸 노을" } });
      expect(
        screen.getByText(BACKGROUND_COPY.library.searching),
      ).toBeInTheDocument();
      expect(
        await screen.findByTestId(`bg-item-${WARM.id}`),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(`bg-item-${STILL.id}`),
      ).not.toBeInTheDocument();

      fireEvent.change(input, { target: { value: "없는검색어" } });
      expect(
        await screen.findByText(BACKGROUND_COPY.library.noMatch("없는검색어")),
      ).toBeInTheDocument();
    } finally {
      api.restore();
    }
  });

  it("영상은 마우스를 올리거나 키보드로 고른 카드만 재생한다", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
    } as MediaQueryList);
    renderPicker();
    const video = (id: string) =>
      screen.queryByTestId(`bg-preview-video-${id}`);
    expect(video(WARM.id)).toBeNull();

    fireEvent.focus(screen.getByTestId(`bg-item-${WARM.id}`));
    expect(video(WARM.id)).toBeInTheDocument();
    expect(video(TEST_SERVICE_BACKGROUNDS[0].id)).toBeNull();

    fireEvent.blur(screen.getByTestId(`bg-item-${WARM.id}`));
    expect(video(WARM.id)).toBeNull();
  });

  it("기기에 저장된 배경에만 저장됨을 표시한다", async () => {
    const cache = await caches.open(mediaCacheNameFor(WARM.mediaUrl));
    await cache.put(WARM.mediaUrl, new Response("video"));
    renderPicker();

    expect(await screen.findByTestId(`bg-saved-${WARM.id}`)).toHaveTextContent(
      BACKGROUND_COPY.saved,
    );
    expect(screen.queryByTestId(`bg-saved-${STILL.id}`)).toBeNull();
  });

  it("배경이 하나도 없으면 빈 상태를 보여 준다", () => {
    resetBackgroundCatalogForTests();
    renderPicker();

    expect(screen.getByText(BACKGROUND_COPY.noBackgrounds)).toBeInTheDocument();
    expect(screen.getByTestId("bg-solid-palette")).toBeInTheDocument();
  });
});
