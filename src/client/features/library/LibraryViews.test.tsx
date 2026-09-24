import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import type { BackgroundMedia } from "#shared";
import { BackgroundLibraryView } from "./index";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { withQueryClient } from "../../test/queryClientFixture";
import { makeBackground } from "../../test/backgroundFixture";
import { resetBackgroundCatalogForTests } from "../backgrounds";
import { refreshBackgroundCatalog } from "../../lib/sync/backgroundSync";

const { probeBackgroundFile } = vi.hoisted(() => ({
  probeBackgroundFile: vi.fn(),
}));

vi.mock("../backgrounds/probeBackgroundFile", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../backgrounds/probeBackgroundFile")
  >()),
  probeBackgroundFile,
}));

const MB = 1024 * 1024;
const LAKE = makeBackground(1, {
  title: "고요한 호수 물결",
  tags: ["잔잔한", "차가운"],
});
const FIRE = makeBackground(2, {
  title: "타오르는 불꽃",
  tags: ["웅장한", "따뜻한"],
});
const STILL = makeBackground(3, {
  title: "본당 성탄 배경",
  kind: "image",
  tags: ["밝은"],
});
const UPLOADED = makeBackground(4, {
  title: "새벽기도 배경",
  tags: [],
});

function listResponse(backgrounds: BackgroundMedia[], canManage = false) {
  return { body: { backgrounds, canManage } };
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
    probeBackgroundFile.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    api?.restore();
  });

  it("모든 배경을 한 갤러리로 보여 주고 일반 사용자에게는 올리기·삭제가 없다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([LAKE, FIRE, STILL]),
    });
    await renderView();

    expect(await screen.findByText("본당 성탄 배경")).toBeInTheDocument();
    expect(screen.getByText("고요한 호수 물결")).toBeInTheDocument();
    expect(screen.getByText("타오르는 불꽃")).toBeInTheDocument();
    expect(screen.getByText("모든 배경")).toBeInTheDocument();
    expect(screen.queryByText("내가 올린 배경")).not.toBeInTheDocument();
    expect(screen.queryByTestId("open-bg-upload-btn")).not.toBeInTheDocument();
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
      await screen.findByText("아직 등록된 배경이 없습니다."),
    ).toBeInTheDocument();
  });

  it("태그로 모든 배경을 거르고, 셸 검색어는 초성으로도 찾는다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([LAKE, FIRE, STILL]),
    });
    const { unmount } = await renderView();
    await screen.findByText("타오르는 불꽃");

    fireEvent.click(screen.getByRole("button", { name: "밝은" }));
    expect(screen.getByText("본당 성탄 배경")).toBeInTheDocument();
    expect(screen.queryByText("타오르는 불꽃")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "웅장한" }));
    expect(screen.getByText("타오르는 불꽃")).toBeInTheDocument();
    expect(screen.queryByText("고요한 호수 물결")).not.toBeInTheDocument();
    unmount();

    await renderView("ㅎㅅ");
    expect(await screen.findByText("고요한 호수 물결")).toBeInTheDocument();
    expect(screen.queryByText("본당 성탄 배경")).not.toBeInTheDocument();
  });

  it("관리자는 배경을 확인을 거쳐 지운다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([LAKE, STILL], true),
      "DELETE /api/backgrounds/uploads/*": () => ({ body: { ok: true } }),
    });
    await renderView();
    await screen.findByText("본당 성탄 배경");

    fireEvent.click(screen.getByTestId(`delete-bg-${STILL.id}`));
    const dialog = screen.getByTestId("bg-delete-dialog");
    expect(dialog).toHaveTextContent(
      "이 배경을 쓰는 모든 사용자의 곡이 배경 없음이 됩니다",
    );

    fireEvent.click(within(dialog).getByTestId("confirm-delete-bg"));

    await waitFor(() =>
      expect(screen.queryByText("본당 성탄 배경")).not.toBeInTheDocument(),
    );
    expect(
      api.calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.path === `/api/backgrounds/uploads/${STILL.id}`,
      ),
    ).toBe(true);
  });

  it("관리자는 파일을 확인하고 출처·라이선스를 적은 뒤에만 올린다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([LAKE], true),
      "POST /api/backgrounds/uploads": () => ({
        status: 201,
        body: { background: UPLOADED },
      }),
    });
    probeBackgroundFile.mockResolvedValue({
      kind: "video",
      width: 1280,
      height: 720,
      durationSec: 12,
      poster: new File([new Uint8Array(4)], "poster.webp", {
        type: "image/webp",
      }),
      isLowResolution: true,
    });
    await renderView();
    await screen.findByText("고요한 호수 물결");

    fireEvent.click(screen.getByTestId("open-bg-upload-btn"));
    fireEvent.change(screen.getByTestId("bg-upload-file-input"), {
      target: {
        files: [
          new File([new Uint8Array(16)], "새벽기도_배경.mp4", {
            type: "video/mp4",
          }),
        ],
      },
    });

    expect(await screen.findByTestId("bg-upload-low-res")).toBeInTheDocument();
    expect(screen.getByLabelText("배경 제목")).toHaveValue("새벽기도 배경");

    const submit = screen.getByTestId("bg-upload-submit");
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByTestId("bg-upload-rights-checkbox"));
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("bg-upload-license-input"), {
      target: { value: "자체 제작 (CC0)" },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(screen.queryByTestId("bg-upload-dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("새벽기도 배경")).toBeInTheDocument();
    expect(
      api.calls.filter(
        (call) =>
          call.method === "POST" && call.path === "/api/backgrounds/uploads",
      ),
    ).toHaveLength(1);
  });

  it("30MB를 넘는 파일은 열어 보지도 않고 이유를 알려 준다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([], true),
    });
    await renderView();
    await waitFor(() =>
      expect(screen.getByTestId("open-bg-upload-btn")).toBeEnabled(),
    );

    fireEvent.click(screen.getByTestId("open-bg-upload-btn"));
    const big = new File([new Uint8Array(1)], "big.mp4", {
      type: "video/mp4",
    });
    Object.defineProperty(big, "size", { value: 31 * MB });
    fireEvent.change(screen.getByTestId("bg-upload-file-input"), {
      target: { files: [big] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("30MB 이하");
    expect(probeBackgroundFile).not.toHaveBeenCalled();
  });

  it("서버에 닿지 않으면 저장된 목록을 보여 주고 올리기 버튼을 내놓지 않는다", async () => {
    api = installFakeApi({}, { offline: true });
    await renderView();

    expect(
      await screen.findByText(/오프라인이라 저장해 둔 목록을 보여 줍니다/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("open-bg-upload-btn")).not.toBeInTheDocument();
  });

  it("관리자여도 오프라인이 되면 올리기·지우기를 막는다", async () => {
    api = installFakeApi({
      "GET /api/backgrounds": () => listResponse([LAKE], true),
    });
    await renderView();
    await waitFor(() =>
      expect(screen.getByTestId("open-bg-upload-btn")).toBeEnabled(),
    );

    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      await act(async () => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(screen.getByTestId("open-bg-upload-btn")).toBeDisabled();
      expect(screen.getByTestId(`delete-bg-${LAKE.id}`)).toBeDisabled();
    } finally {
      onLine.mockRestore();
    }
  });
});
