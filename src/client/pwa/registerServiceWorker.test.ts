import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerServiceWorker,
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
  waiting = false,
}: {
  controlled?: boolean;
  active?: boolean;
  waiting?: boolean;
} = {}): ReturnType<typeof vi.fn> {
  const getRegistration = vi.fn(async () => ({
    ...(active ? { active: {} } : {}),
    ...(waiting ? { waiting: {} } : {}),
  }));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { controller: controlled ? {} : null, getRegistration },
  });
  return getRegistration;
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.useRealTimers();
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

  it("등록 정보를 읽지 못하면 새 버전을 적용하지 않는다", async () => {
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);

    hooks().onNeedRefresh?.();
    await flushPromises();

    expect(apply).not.toHaveBeenCalled();
  });
});

describe("새로고침할 때 새 버전 적용", () => {
  beforeEach(() => {
    __resetServiceWorkerStateForTests();
  });

  it("부팅할 때 대기 중인 새 버전이 있으면 적용하고 제어가 바뀐 뒤 새로고침한다", async () => {
    stubServiceWorker({ controlled: true, waiting: true });
    const reload = stubLocation();
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);

    hooks().onNeedRefresh?.();
    await flushPromises();
    expect(apply).toHaveBeenCalledWith(true);
    expect(reload).not.toHaveBeenCalled();

    hooks().onNeedReload?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("이번 로드 중에 발견한 새 버전은 다음 새로고침으로 미룬다", async () => {
    stubServiceWorker({ controlled: true });
    const reload = stubLocation();
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);

    hooks().onNeedRefresh?.();
    await flushPromises();

    expect(apply).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("송출 화면은 새로고침해도 새 버전을 적용하지 않는다", async () => {
    stubServiceWorker({ controlled: true, waiting: true });
    const reload = stubLocation("/present/p1/fullscreen");
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);

    hooks().onNeedRefresh?.();
    await flushPromises();
    hooks().onNeedReload?.();

    expect(apply).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("송출 화면에서 편집 화면으로 옮긴 뒤 더 새로운 버전이 와도 새로고침하지 않는다", async () => {
    stubServiceWorker({ controlled: true, waiting: true });
    stubLocation("/present/p1/fullscreen");
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);
    hooks().onNeedRefresh?.();
    await flushPromises();

    const reload = stubLocation();
    hooks().onNeedRefresh?.();
    await flushPromises();

    expect(apply).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("다른 탭이 적용해 제어가 바뀌면 이 탭은 새로고침하지 않는다", async () => {
    stubServiceWorker({ controlled: true });
    const reload = stubLocation();
    const { registrar, hooks } = makeRegistrar();
    registerServiceWorker(registrar);
    hooks().onNeedRefresh?.();
    await flushPromises();

    hooks().onNeedReload?.();

    expect(reload).not.toHaveBeenCalled();
  });
});

describe("갱신 확인", () => {
  beforeEach(() => {
    __resetServiceWorkerStateForTests();
    stubServiceWorker({ controlled: true });
  });

  function registerWith(update: () => Promise<void>): void {
    const { registrar, hooks } = makeRegistrar();
    registerServiceWorker(registrar);
    hooks().onRegisteredSW?.("/sw.js", {
      update,
    } as unknown as ServiceWorkerRegistration);
  }

  it("30분마다 새 버전을 확인한다", () => {
    vi.useFakeTimers();
    const update = vi.fn(async () => {});
    registerWith(update);

    vi.advanceTimersByTime(30 * 60_000);

    expect(update).toHaveBeenCalledTimes(1);
  });

  it("탭이 다시 보이면 새 버전을 확인한다", () => {
    const update = vi.fn(async () => {});
    registerWith(update);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    document.dispatchEvent(new Event("visibilitychange"));

    expect(update).toHaveBeenCalledTimes(1);
  });

  it("확인이 실패해도 오류를 던지지 않는다", async () => {
    const update = vi.fn(async () => {
      throw new TypeError("offline");
    });
    registerWith(update);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();

    expect(update).toHaveBeenCalledTimes(1);
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
