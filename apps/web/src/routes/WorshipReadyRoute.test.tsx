import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import {
  __loadDocumentsForTests,
  resetPresentationStore,
  SEED_PRESENTATIONS,
  SEED_PRESENTATION_IDS,
} from "../features/presentation";
import { signInAsTestUser } from "../test/sessionFixture";
import { resetFakeCacheStorage } from "../test/fakeCacheStorage";
import { getOfflineDB } from "../lib/storage/db";
import { WorshipReadyRoute } from "./WorshipReadyRoute";

const DOC_ID = SEED_PRESENTATION_IDS[0];

function renderReady(path = `/present/${DOC_ID}/ready`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/present/:presentationId/ready"
          element={<WorshipReadyRoute />}
        />
        <Route
          path="/present/:presentationId/control"
          element={<div data-testid="control-stub" />}
        />
        <Route
          path="/present/:presentationId/fullscreen"
          element={<div data-testid="fullscreen-stub" />}
        />
        <Route
          path="/presentations"
          element={<div data-testid="presentations-stub" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");

beforeEach(async () => {
  signInAsTestUser();
  resetPresentationStore();
  __loadDocumentsForTests(SEED_PRESENTATIONS);
  resetFakeCacheStorage();
  const db = await getOfflineDB();
  await db.clear("sync_meta");

  globalThis.fetch = vi.fn(
    async () => new Response(new ArrayBuffer(2048), { status: 200 }),
  ) as unknown as typeof fetch;
  Object.defineProperty(navigator, "storage", {
    value: {
      persisted: async () => false,
      persist: async () => true,
      estimate: async () => ({ usage: 4096, quota: 1_000_000 }),
    },
    configurable: true,
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) {
    Object.defineProperty(navigator, "storage", originalStorage);
  }
  vi.restoreAllMocks();
});

describe("WorshipReadyRoute", () => {
  it("세트의 곡을 모두 줄로 보여 준다", async () => {
    renderReady();

    const rows = await screen.findAllByTestId("prep-song-row");
    expect(rows.length).toBe(SEED_PRESENTATIONS[0].items.length);
  });

  it("전부 받으면 '오프라인 송출 가능' 배지를 띄운다", async () => {
    renderReady();

    await waitFor(() =>
      expect(screen.getByTestId("offline-ready-badge")).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("offline-pending-badge"),
    ).not.toBeInTheDocument();
  });

  it("총 캐시 용량을 표시한다", async () => {
    renderReady();

    await waitFor(() =>
      expect(screen.getByTestId("cache-total-size")).toHaveTextContent("MB"),
    );
  });

  it("다운로드에 실패하면 경고와 재시도 버튼을 보여 준다", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof fetch;

    renderReady();

    await waitFor(() =>
      expect(screen.getByTestId("cache-failed-warning")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("cache-retry-btn")).toBeInTheDocument();
  });

  it("준비가 끝나지 않아도 송출 버튼을 막지 않는다 (권장 관문)", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof fetch;

    renderReady();

    await waitFor(() =>
      expect(screen.getByTestId("present-anyway-notice")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("start-solo-btn")).toBeEnabled();
    expect(screen.getByTestId("start-presenter-btn")).toBeEnabled();
  });

  it("영구 저장소가 거부되면 경고를 띄운다", async () => {
    Object.defineProperty(navigator, "storage", {
      value: {
        persisted: async () => false,
        persist: async () => false,
        estimate: async () => ({ usage: 0, quota: 0 }),
      },
      configurable: true,
    });

    renderReady();

    await waitFor(() =>
      expect(
        screen.getByTestId("storage-persist-warning"),
      ).toBeInTheDocument(),
    );
  });

  it("발표자 보기 버튼이 조작 창 경로로 이동한다", async () => {
    renderReady();
    await screen.findAllByTestId("prep-song-row");

    fireEvent.click(screen.getByTestId("start-presenter-btn"));

    expect(await screen.findByTestId("control-stub")).toBeInTheDocument();
  });

  it("단독 전체화면 버튼이 송출 경로로 이동한다", async () => {
    renderReady();
    await screen.findAllByTestId("prep-song-row");

    fireEvent.click(screen.getByTestId("start-solo-btn"));

    expect(await screen.findByTestId("fullscreen-stub")).toBeInTheDocument();
  });

  it("없는 세트는 대시보드로 되돌린다", async () => {
    renderReady("/present/99999999-9999-4999-8999-999999999999/ready");

    expect(
      await screen.findByTestId("presentations-stub"),
    ).toBeInTheDocument();
  });
});
