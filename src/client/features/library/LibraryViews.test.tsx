import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import type { BackgroundMedia } from "#shared";
import { BackgroundLibraryView } from "./index";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { withQueryClient } from "../../test/queryClientFixture";
import { makeBackground } from "../../test/backgroundFixture";
import { resetBackgroundCatalogForTests } from "../backgrounds";
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

  it("셸 검색어는 제목을 초성으로도 찾는다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([LAKE, FIRE, STILL]),
    });

    await renderView("ㅎㅅ");
    expect(
      await screen.findByRole("img", { name: "고요한 호수 물결" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "본당 성탄 배경" }),
    ).not.toBeInTheDocument();
  });

  it("셸 검색어는 검색 키워드로도 찾는다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([LAKE, FIRE, STILL]),
    });

    await renderView("선포");
    expect(
      await screen.findByRole("img", { name: "타오르는 불꽃" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "고요한 호수 물결" }),
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
