import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerServiceWorker,
  getServiceWorkerState,
  applyServiceWorkerUpdate,
  __resetServiceWorkerStateForTests,
  type ServiceWorkerRegistrar,
} from "./registerServiceWorker";

type Hooks = Parameters<ServiceWorkerRegistrar>[0];

function makeRegistrar(): {
  registrar: ServiceWorkerRegistrar;
  hooks: () => Hooks;
  apply: ReturnType<typeof vi.fn>;
  calls: () => number;
} {
  let captured: Hooks = {};
  let count = 0;
  const apply = vi.fn(async () => {});
  return {
    registrar: (options) => {
      captured = options;
      count += 1;
      return apply;
    },
    hooks: () => captured,
    apply,
    calls: () => count,
  };
}

describe("registerServiceWorker", () => {
  beforeEach(() => {
    __resetServiceWorkerStateForTests();
    Object.defineProperty(navigator, "serviceWorker", {
      value: {},
      configurable: true,
    });
  });

  it("새 버전이 준비되어도 자동으로 새로고침하지 않고 상태만 올린다", () => {
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);

    expect(getServiceWorkerState().needRefresh).toBe(false);

    hooks().onNeedRefresh?.();

    expect(getServiceWorkerState().needRefresh).toBe(true);
    expect(apply).not.toHaveBeenCalled();
  });

  it("오프라인 준비 완료 신호를 상태로 노출한다", () => {
    const { registrar, hooks } = makeRegistrar();
    registerServiceWorker(registrar);

    hooks().onOfflineReady?.();

    expect(getServiceWorkerState().offlineReady).toBe(true);
  });

  it("사용자가 적용을 요청하면 새로고침과 함께 갱신한다", async () => {
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);
    hooks().onNeedRefresh?.();

    await applyServiceWorkerUpdate();

    expect(apply).toHaveBeenCalledWith(true);
  });

  it("두 번 호출해도 한 번만 등록한다", () => {
    const { registrar, calls } = makeRegistrar();
    registerServiceWorker(registrar);
    registerServiceWorker(registrar);

    expect(calls()).toBe(1);
  });

  it("Service Worker가 없는 환경에서는 조용히 넘어간다", () => {
    const original = Object.getOwnPropertyDescriptor(
      navigator,
      "serviceWorker",
    );
    // @ts-expect-error navigator.serviceWorker is read-only in the DOM types
    delete navigator.serviceWorker;

    const { registrar, calls } = makeRegistrar();
    expect(() => registerServiceWorker(registrar)).not.toThrow();
    expect(calls()).toBe(0);

    if (original) Object.defineProperty(navigator, "serviceWorker", original);
  });

  it("등록 전에는 적용 요청이 아무 일도 하지 않는다", async () => {
    await expect(applyServiceWorkerUpdate()).resolves.toBeUndefined();
  });
});
