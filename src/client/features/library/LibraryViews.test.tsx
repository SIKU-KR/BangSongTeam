import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { BACKGROUND_SEARCH_MAX_LENGTH, type BackgroundMedia } from "#shared";
import { BackgroundLibraryView } from "./index";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { withQueryClient } from "../../test/queryClientFixture";
import { makeBackground } from "../../test/backgroundFixture";
import { resetBackgroundCatalogForTests } from "../backgrounds/backgroundCatalog";
import { refreshBackgroundCatalog } from "../../lib/sync/backgroundSync";
import { BACKGROUND_COPY } from "#copy/backgrounds";

const LAKE = makeBackground(1, { title: "고요한 호수 물결" });
const FIRE = makeBackground(2, {
  title: "타오르는 불꽃",
  keywords: ["빨간색", "불", "선포"],
});
const STILL = makeBackground(3, { title: "본당 성탄 배경", kind: "image" });

function listResponse(backgrounds: BackgroundMedia[]) {
  return { body: { backgrounds } };
}

async function renderView(searchQuery = "") {
  const view = render(
    withQueryClient(<BackgroundLibraryView searchQuery={searchQuery} />),
  );
  await act(async () => {
    await refreshBackgroundCatalog();
  });
  return view;
}

describe("BackgroundLibraryView", () => {
  let api: FakeApi;

  beforeEach(() => {
    resetBackgroundCatalogForTests();
  });

  afterEach(() => {
    api?.restore();
  });

  it("모든 배경을 한 갤러리로 보여 주고 삭제는 없다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([LAKE, FIRE, STILL]),
    });
    await renderView();

    expect(
      await screen.findByRole("img", { name: "본당 성탄 배경" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "고요한 호수 물결" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "타오르는 불꽃" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("내가 올린 배경")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`delete-bg-${LAKE.id}`),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/300MB/)).not.toBeInTheDocument();
  });

  it("배경이 없으면 빈 상태를 안내한다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([]),
    });
    await renderView();

    expect(
      await screen.findByText(BACKGROUND_COPY.noBackgrounds),
    ).toBeInTheDocument();
  });

  it("카드마다 영상·이미지를 표시하고 종류로 거른다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([LAKE, FIRE, STILL]),
    });
    await renderView();
    await screen.findByRole("img", { name: "타오르는 불꽃" });

    expect(screen.getByTestId(`bg-kind-${LAKE.id}`)).toHaveTextContent(
      BACKGROUND_COPY.video,
    );
    expect(screen.getByTestId(`bg-kind-${STILL.id}`)).toHaveTextContent(
      BACKGROUND_COPY.image,
    );

    fireEvent.click(
      screen.getByRole("button", { name: BACKGROUND_COPY.image }),
    );
    expect(
      screen.getByRole("img", { name: "본당 성탄 배경" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "타오르는 불꽃" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: BACKGROUND_COPY.video }),
    );
    expect(
      screen.getByRole("img", { name: "타오르는 불꽃" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "고요한 호수 물결" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "본당 성탄 배경" }),
    ).not.toBeInTheDocument();
  });

  it("셸 검색어는 서버 벡터 검색 결과를 가까운 순서대로 보여 준다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([LAKE, FIRE, STILL]),
      "GET /api/backgrounds/search": () => ({
        body: {
          results: [
            { id: FIRE.id, score: 0.72 },
            { id: LAKE.id, score: 0.61 },
          ],
        },
      }),
    });

    await renderView("뜨겁게 선포하는 배경");
    await screen.findByRole("img", { name: "타오르는 불꽃" });
    expect(
      screen.getAllByRole("img").map((img) => img.getAttribute("alt")),
    ).toEqual(["타오르는 불꽃", "고요한 호수 물결"]);
    const searchCall = api.calls.find(
      (call) => call.path === "/api/backgrounds/search",
    );
    expect(new URLSearchParams(searchCall?.search).get("q")).toBe(
      "뜨겁게 선포하는 배경",
    );
  });

  it("서버가 받는 길이보다 긴 검색어는 잘라 보낸다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([LAKE, FIRE, STILL]),
      "GET /api/backgrounds/search": () => ({
        body: { results: [{ id: LAKE.id, score: 0.7 }] },
      }),
    });

    await renderView("잔잔한 호수 ".repeat(10));
    await screen.findByRole("img", { name: "고요한 호수 물결" });
    const searchCall = api.calls.find(
      (call) => call.path === "/api/backgrounds/search",
    );
    expect(
      new URLSearchParams(searchCall?.search).get("q")?.length,
    ).toBeLessThanOrEqual(BACKGROUND_SEARCH_MAX_LENGTH);
  });

  it("검색할 수 없으면 다시 검색하라고 안내한다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([LAKE, FIRE, STILL]),
      "GET /api/backgrounds/search": () => ({
        status: 503,
        body: { error: "unavailable" },
      }),
    });

    await renderView("성탄");
    expect(
      await screen.findByText(BACKGROUND_COPY.library.searchFailed),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "본당 성탄 배경" }),
    ).not.toBeInTheDocument();
  });

  it("서버에 닿지 않으면 저장된 목록을 보여 준다", async () => {
    api = installFakeApi({}, { offline: true });
    await renderView();

    expect(
      await screen.findByText(/오프라인이라 저장해 둔 배경만 보여요/),
    ).toBeInTheDocument();
  });
});
