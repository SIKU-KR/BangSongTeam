import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerServiceWorker,
  getServiceWorkerState,
  applyServiceWorkerUpdate,
  reloadIfUncontrolled,
  reloadOnStaleChunk,
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

const RELOAD_KEY = "sw-uncontrolled-reload";
const STALE_CHUNK_KEY = "sw-stale-chunk-reload";
const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
const originalServiceWorker = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);

function stubLocation(pathname = "/presentations"): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname, reload },
  });
  return reload;
}

function stubServiceWorker({
  controlled = false,
  active = true,
}: { controlled?: boolean; active?: boolean } = {}): ReturnType<typeof vi.fn> {
  const getRegistration = vi.fn(async () => (active ? { active: {} } : {}));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { controller: controlled ? {} : null, getRegistration },
  });
  return getRegistration;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  if (originalLocation) {
    Object.defineProperty(window, "location", originalLocation);
  }
  if (originalServiceWorker) {
    Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  } else {
    Reflect.deleteProperty(navigator, "serviceWorker");
  }
});

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

describe("새 버전 적용 뒤 새로고침", () => {
  beforeEach(() => {
    __resetServiceWorkerStateForTests();
    stubServiceWorker({ controlled: true });
  });

  it("다른 탭이 적용해 제어가 바뀌면 이 탭은 새로고침하지 않는다", () => {
    const reload = stubLocation();
    const { registrar, hooks } = makeRegistrar();
    registerServiceWorker(registrar);
    hooks().onNeedRefresh?.();

    hooks().onNeedReload?.();

    expect(reload).not.toHaveBeenCalled();
    expect(getServiceWorkerState().needRefresh).toBe(true);
  });

  it("이 탭에서 적용을 요청했으면 제어가 바뀐 뒤 새로고침한다", async () => {
    const reload = stubLocation();
    const { registrar, hooks } = makeRegistrar();
    registerServiceWorker(registrar);

    await applyServiceWorkerUpdate();
    expect(reload).not.toHaveBeenCalled();

    hooks().onNeedReload?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("적용을 요청한 탭이라도 송출 화면이면 새로고침하지 않는다", async () => {
    const reload = stubLocation("/present/p1/fullscreen");
    const { registrar, hooks } = makeRegistrar();
    registerServiceWorker(registrar);
    await applyServiceWorkerUpdate();

    hooks().onNeedReload?.();

    expect(reload).not.toHaveBeenCalled();
  });

  it("다른 탭이 먼저 적용했으면 이 탭의 적용은 곧바로 한 번 새로고침한다", async () => {
    const reload = stubLocation();
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);
    hooks().onNeedRefresh?.();
    hooks().onNeedReload?.();

    await applyServiceWorkerUpdate();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it("송출 중에 제어가 바뀌었으면 송출을 마친 뒤 적용할 때 새로고침한다", async () => {
    const reload = stubLocation("/present/p1/fullscreen");
    const { registrar, hooks } = makeRegistrar();
    registerServiceWorker(registrar);
    hooks().onNeedRefresh?.();
    await applyServiceWorkerUpdate();
    hooks().onNeedReload?.();
    expect(reload).not.toHaveBeenCalled();

    const reloadAfter = stubLocation();
    await applyServiceWorkerUpdate();

    expect(reloadAfter).toHaveBeenCalledTimes(1);
  });

  it("송출 중이라 넘긴 적용 요청은 나중에 다른 탭의 갱신으로 이 탭을 새로고침하지 않는다", async () => {
    stubLocation("/present/p1/fullscreen");
    const { registrar, hooks } = makeRegistrar();
    registerServiceWorker(registrar);
    await applyServiceWorkerUpdate();
    hooks().onNeedReload?.();

    const reload = stubLocation();
    hooks().onNeedRefresh?.();
    hooks().onNeedReload?.();

    expect(reload).not.toHaveBeenCalled();
  });

  it("제어가 바뀐 뒤 더 새로운 버전이 대기하면 그 버전을 적용한다", async () => {
    const reload = stubLocation();
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);
    hooks().onNeedRefresh?.();
    hooks().onNeedReload?.();
    hooks().onNeedRefresh?.();

    await applyServiceWorkerUpdate();

    expect(apply).toHaveBeenCalledWith(true);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("reloadOnStaleChunk", () => {
  beforeEach(() => {
    __resetServiceWorkerStateForTests();
  });

  it("옛 청크를 받지 못하면 한 번만 새로고침한다", () => {
    const reload = stubLocation("/editor/p1");

    reloadOnStaleChunk();
    reloadOnStaleChunk();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(STALE_CHUNK_KEY)).not.toBeNull();
  });

  it("지난 새로고침에서 1분이 지났으면 다시 새로고침한다", () => {
    const reload = stubLocation("/editor/p1");
    sessionStorage.setItem(STALE_CHUNK_KEY, String(Date.now() - 61_000));

    reloadOnStaleChunk();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("송출 화면에서는 새로고침하지 않는다", () => {
    const reload = stubLocation("/present/p1/fullscreen");

    reloadOnStaleChunk();

    expect(reload).not.toHaveBeenCalled();
  });

  it("sessionStorage를 쓸 수 없으면 새로고침하지 않는다", () => {
    const reload = stubLocation("/editor/p1");
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });

    reloadOnStaleChunk();

    expect(reload).not.toHaveBeenCalled();
  });

  it("등록하면 청크 로드 실패 이벤트에 새로고침을 건다", () => {
    stubServiceWorker({ controlled: true });
    const reload = stubLocation("/editor/p1");
    registerServiceWorker(makeRegistrar().registrar);

    window.dispatchEvent(new Event("vite:preloadError"));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("reloadIfUncontrolled", () => {
  beforeEach(() => {
    __resetServiceWorkerStateForTests();
  });

  it("온라인에서 SW 제어 없이 열리면 한 번만 새로고침한다", async () => {
    const reload = stubLocation();
    stubServiceWorker();

    await reloadIfUncontrolled();
    await reloadIfUncontrolled();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_KEY)).not.toBeNull();
  });

  it("이미 한 번 새로고침한 탭이면 다시 새로고침하지 않는다", async () => {
    const reload = stubLocation();
    stubServiceWorker();
    sessionStorage.setItem(RELOAD_KEY, "1");

    await reloadIfUncontrolled();

    expect(reload).not.toHaveBeenCalled();
  });

  it("오프라인이면 새로고침하지 않는다", async () => {
    const reload = stubLocation();
    stubServiceWorker();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    await reloadIfUncontrolled();

    expect(reload).not.toHaveBeenCalled();
  });

  it("이미 SW가 제어하면 새로고침하지 않고 표시를 지운다", async () => {
    const reload = stubLocation();
    stubServiceWorker({ controlled: true });
    sessionStorage.setItem(RELOAD_KEY, "1");

    await reloadIfUncontrolled();

    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
  });

  it("활성 SW가 없으면 새로고침하지 않는다", async () => {
    const reload = stubLocation();
    stubServiceWorker({ active: false });

    await reloadIfUncontrolled();

    expect(reload).not.toHaveBeenCalled();
  });

  it.each(["getItem", "setItem"] as const)(
    "sessionStorage %s가 실패하면 새로고침하지 않는다",
    async (method) => {
      const reload = stubLocation();
      stubServiceWorker();
      vi.stubGlobal("sessionStorage", {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
        [method]: () => {
          throw new DOMException("denied", "SecurityError");
        },
      });

      await reloadIfUncontrolled();

      expect(reload).not.toHaveBeenCalled();
    },
  );

  it("sessionStorage에 접근할 수 없으면 새로고침하지 않는다", async () => {
    const reload = stubLocation();
    stubServiceWorker();
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      "sessionStorage",
    );
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });

    await reloadIfUncontrolled();

    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    expect(reload).not.toHaveBeenCalled();
  });

  it("송출 화면에서는 SW 제어가 없어도 새로고침하지 않는다", async () => {
    const reload = stubLocation("/present/p1/fullscreen");
    const getRegistration = stubServiceWorker();

    await reloadIfUncontrolled();

    expect(reload).not.toHaveBeenCalled();
    expect(getRegistration).not.toHaveBeenCalled();
  });

  it("등록할 때 제어 여부를 확인해 새로고침한다", async () => {
    const reload = stubLocation();
    stubServiceWorker();
    const { registrar } = makeRegistrar();

    registerServiceWorker(registrar);

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
