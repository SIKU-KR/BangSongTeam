import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PresentationDocument } from "#shared";
import { signOutForTests } from "../test/sessionFixture";
import { withQueryClient } from "../test/queryClientFixture";
import { installFakeApi, type FakeApi } from "../test/fakeApi";
import { SEED_PRESENTATIONS } from "../features/presentation/mockPresentations";
import {
  getPresentationById,
  resetPresentationStore,
} from "../features/presentation/presentationStore";
import { SharePreviewRoute } from "./SharePreviewRoute";

const OWNER = "0000000000000000owner";

function renderAt(path: string) {
  return render(
    withQueryClient(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/s/:token" element={<SharePreviewRoute />} />
          <Route path="/" element={<p data-testid="root-probe" />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe("SharePreviewRoute (로그인하지 않은 /s/:token)", () => {
  let api: FakeApi | null = null;
  const shared = {
    ...SEED_PRESENTATIONS[0],
    userId: OWNER,
    folderId: null,
    access: { ownerName: "인도자" },
  } as PresentationDocument;

  beforeEach(() => {
    signOutForTests();
    resetPresentationStore();
  });

  afterEach(() => api?.restore());

  it("로그인 없이 보기 전용 편집기로 연다", async () => {
    api = installFakeApi({
      "GET /api/share/*": () => ({ body: { document: shared } }),
    });
    renderAt("/s/tok-first");

    expect(await screen.findByTestId("read-only-banner")).toHaveTextContent(
      "로그인하고 사본을 만드세요",
    );
    expect(screen.getByTestId("header-shared-badge")).toHaveTextContent(
      "인도자님이 공유",
    );
    expect(screen.queryByTestId("header-back-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("header-share-btn")).not.toBeInTheDocument();
    expect(getPresentationById(shared.id)?.access).toEqual({
      ownerName: "인도자",
    });
    expect(api.calls.some((call) => call.path.endsWith("/join"))).toBe(false);
  });

  it("사본 만들기를 누르면 로그인 화면을 띄우고, 돌아가면 다시 세트를 본다", async () => {
    api = installFakeApi({
      "GET /api/share/*": () => ({ body: { document: shared } }),
    });
    renderAt("/s/tok-first");

    fireEvent.click(await screen.findByTestId("make-copy-btn"));

    expect(await screen.findByTestId("login-description")).toHaveTextContent(
      "사본을 내 드라이브에 만들어",
    );
    expect(screen.queryByTestId("editor-route")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("login-cancel-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("editor-route")).toBeInTheDocument(),
    );
  });

  it("만료된 링크는 안내를 보여 준다", async () => {
    api = installFakeApi({
      "GET /api/share/*": () => ({
        status: 404,
        body: { error: "링크가 만료되었거나 공유가 해제되었습니다" },
      }),
    });
    renderAt("/s/expired");

    expect(await screen.findByTestId("share-link-error")).toHaveTextContent(
      "링크가 만료되었거나 공유가 해제되었습니다",
    );
  });
});
