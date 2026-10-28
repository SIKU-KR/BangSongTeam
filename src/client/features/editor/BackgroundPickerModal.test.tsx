import React from "react";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "../../test/router";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { COMMON_COPY } from "#copy/common";
import { resetFakeCacheStorage } from "../../test/fakeCacheStorage";
import { __resetMediaCachingForTests } from "../../lib/offline/mediaCache";
import { withQueryClient } from "../../test/queryClientFixture";
import { installFakeApi } from "../../test/fakeApi";
import {
  installServiceWorker,
  removeServiceWorker,
} from "../../test/serviceWorkerFixture";

const { refreshBackgroundCatalog, retryBackgroundCatalogIfNeeded } = vi.hoisted(
  () => ({
    refreshBackgroundCatalog: vi.fn(async () => undefined),
    retryBackgroundCatalogIfNeeded: vi.fn(),
  }),
);

vi.mock("../../lib/sync/backgroundSync", () => ({
  refreshBackgroundCatalog,
  retryBackgroundCatalogIfNeeded,
}));

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
    retryBackgroundCatalogIfNeeded.mockClear();
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

  it("검색어를 제출하면 제목·키워드에 맞는 배경만 보여 주고, 맞는 배경이 없으면 알려 준다", async () => {
    const api = installFakeApi({});
    try {
      renderPicker();

      const input = screen.getByTestId("bg-picker-search-input");
      const submit = screen.getByRole("button", { name: COMMON_COPY.search });
      expect(submit).toBeDisabled();

      fireEvent.change(input, { target: { value: "감사 노을" } });
      expect(screen.getByTestId(`bg-item-${STILL.id}`)).toBeInTheDocument();

      fireEvent.click(submit);
      expect(
        await screen.findByTestId(`bg-item-${WARM.id}`),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(`bg-item-${STILL.id}`),
      ).not.toBeInTheDocument();
      expect(
        api.calls.some((call) =>
          call.path.startsWith("/api/backgrounds/search"),
        ),
      ).toBe(false);

      fireEvent.change(input, { target: { value: "없는검색어" } });
      fireEvent.submit(input);
      expect(
        await screen.findByText(BACKGROUND_COPY.library.noMatch("없는검색어")),
      ).toBeInTheDocument();

      fireEvent.change(input, { target: { value: "" } });
      expect(screen.getByTestId(`bg-item-${STILL.id}`)).toBeInTheDocument();
    } finally {
      api.restore();
    }
  });

  it("검색창이 비어 있는 동안 예시 검색어를 돌려 가며 보여 준다", () => {
    vi.useFakeTimers();
    try {
      renderPicker();
      const input = screen.getByTestId("bg-picker-search-input");
      const [first, second] = BACKGROUND_COPY.searchPlaceholders;
      expect(input).toHaveAttribute("placeholder", first);

      act(() => vi.advanceTimersByTime(3500));
      expect(input).toHaveAttribute("placeholder", second);

      fireEvent.change(input, { target: { value: "노을" } });
      act(() => vi.advanceTimersByTime(7000));
      expect(input).toHaveAttribute("placeholder", second);
    } finally {
      vi.useRealTimers();
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

  it("서버가 목록을 주지 못했으면 가진 목록은 그대로 두고 다시 받기를 보여 준다", () => {
    setBackgroundCatalogForTests(TEST_SERVICE_BACKGROUNDS, "error");
    renderPicker();

    expect(screen.getByText(BACKGROUND_COPY.catalogFailed)).toBeInTheDocument();
    expect(
      screen.getByTestId(`bg-item-${TEST_SERVICE_BACKGROUNDS[0].id}`),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: COMMON_COPY.retry }));

    expect(retryBackgroundCatalogIfNeeded).toHaveBeenCalledWith("manual");
  });

  it("목록이 비었는데 서버가 주지 못했으면 배경이 없다고 하지 않는다", () => {
    setBackgroundCatalogForTests([], "error");
    renderPicker();

    expect(screen.getByText(BACKGROUND_COPY.catalogFailed)).toBeInTheDocument();
    expect(screen.queryByText(BACKGROUND_COPY.noBackgrounds)).toBeNull();
  });

  describe("고른 배경을 저장하는지 알리는 안내", () => {
    afterEach(() => {
      removeServiceWorker();
      Reflect.deleteProperty(navigator, "connection");
    });

    it("받아 두는 브라우저에선 오프라인에서도 재생된다고 알린다", () => {
      installServiceWorker();
      renderPicker();

      expect(
        screen.getByText(BACKGROUND_COPY.picker.cachedHint),
      ).toBeInTheDocument();
    });

    it("데이터 절약 모드에선 지금 받지 않고 송출을 시작할 때 저장한다고 알린다", () => {
      installServiceWorker();
      Object.defineProperty(navigator, "connection", {
        value: { saveData: true },
        configurable: true,
      });
      renderPicker();

      expect(
        screen.getByText(BACKGROUND_COPY.picker.dataSaverHint),
      ).toBeInTheDocument();
      expect(screen.queryByText(BACKGROUND_COPY.picker.cachedHint)).toBeNull();
    });

    it("서비스 워커가 없는 브라우저에선 저장한다고 하지 않고 인터넷으로 재생한다고 알린다", () => {
      removeServiceWorker();
      renderPicker();

      expect(
        screen.getByText(BACKGROUND_COPY.picker.streamedHint),
      ).toBeInTheDocument();
      expect(screen.queryByText(BACKGROUND_COPY.picker.cachedHint)).toBeNull();
    });
  });
});
