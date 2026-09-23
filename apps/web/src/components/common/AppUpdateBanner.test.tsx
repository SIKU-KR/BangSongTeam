import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppUpdateBanner } from "./AppUpdateBanner";
import {
  registerServiceWorker,
  __resetServiceWorkerStateForTests,
  type ServiceWorkerRegistrar,
} from "../../pwa/registerServiceWorker";

type Hooks = Parameters<ServiceWorkerRegistrar>[0];

let hooks: Hooks = {};
const apply = vi.fn(async () => {});
const registrar: ServiceWorkerRegistrar = (options) => {
  hooks = options;
  return apply;
};

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppUpdateBanner />
    </MemoryRouter>,
  );
}

describe("AppUpdateBanner", () => {
  beforeEach(() => {
    __resetServiceWorkerStateForTests();
    apply.mockClear();
    hooks = {};
    Object.defineProperty(navigator, "serviceWorker", {
      value: {},
      configurable: true,
    });
  });

  it("대기 중인 새 버전이 없으면 아무것도 그리지 않는다", () => {
    renderAt("/presentations");
    expect(screen.queryByTestId("app-update-banner")).not.toBeInTheDocument();
  });

  it("새 버전이 대기 중이면 편집 화면에 배너를 띄운다", () => {
    registerServiceWorker(registrar);
    hooks.onNeedRefresh?.();

    renderAt("/presentations");

    expect(screen.getByTestId("app-update-banner")).toBeInTheDocument();
  });

  it("송출 경로에서는 새 버전이 대기 중이어도 배너를 띄우지 않는다", () => {
    registerServiceWorker(registrar);
    hooks.onNeedRefresh?.();

    renderAt("/present/abc/fullscreen");

    expect(screen.queryByTestId("app-update-banner")).not.toBeInTheDocument();
  });
});
