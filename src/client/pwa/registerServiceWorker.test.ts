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
}: { controlled?: boolean; active?: boolean } = {}): ReturnType<typeof vi.fn> {
  const getRegistration = vi.fn(async () => (active ? { active: {} } : {}));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { controller: controlled ? {} : null, getRegistration },
  });
  return getRegistration;
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
});

function fakeRegistration({
  waiting = false,
  update = vi.fn(async () => {}),
}: {
  waiting?: boolean;
  update?: () => Promise<void>;
} = {}): ServiceWorkerRegistration {
  return {
    waiting: waiting ? {} : null,
    update,
  } as unknown as ServiceWorkerRegistration;
}

describe("새로고침할 때 새 버전 적용", () => {
  beforeEach(() => {
    __resetServiceWorkerStateForTests();
    stubServiceWorker({ controlled: true });
  });

  it("등록을 마칠 때 대기 중인 새 버전이 있으면 적용하고 제어가 바뀐 뒤 새로고침한다", () => {
    const reload = stubLocation();
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);

    hooks().onRegisteredSW?.("/sw.js", fakeRegistration({ waiting: true }));
    expect(apply).toHaveBeenCalledWith(true);
    expect(reload).not.toHaveBeenCalled();

    hooks().onNeedReload?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("적용을 요청하고 5초가 지나서 제어가 바뀌면 새로고침하지 않는다", () => {
    vi.useFakeTimers();
    const reload = stubLocation();
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);
    hooks().onRegisteredSW?.("/sw.js", fakeRegistration({ waiting: true }));
    expect(apply).toHaveBeenCalledWith(true);

    vi.advanceTimersByTime(5_000);
    hooks().onNeedReload?.();

    expect(reload).not.toHaveBeenCalled();
  });

  it("등록을 마칠 때 대기 중인 새 버전이 없으면 적용하지 않는다", () => {
    const reload = stubLocation();
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);

    hooks().onRegisteredSW?.("/sw.js", fakeRegistration());

    expect(apply).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("송출 화면은 새로고침해도 새 버전을 적용하지 않는다", () => {
    const reload = stubLocation("/present/p1/fullscreen");
    const { registrar, hooks, apply } = makeRegistrar();
    registerServiceWorker(registrar);

    hooks().onRegisteredSW?.("/sw.js", fakeRegistration({ waiting: true }));
    hooks().onNeedReload?.();

    expect(apply).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("다른 탭이 적용해 제어가 바뀌면 이 탭은 새로고침하지 않는다", () => {
    const reload = stubLocation();
    const { registrar, hooks } = makeRegistrar();
    registerServiceWorker(registrar);
    hooks().onRegisteredSW?.("/sw.js", fakeRegistration());

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
    hooks().onRegisteredSW?.("/sw.js", fakeRegistration({ update }));
  }

  function becomeVisible(): void {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  }

  function becomeHidden(): void {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  }

  function captureIntervalTick(): () => void {
    let tick: () => void = () => undefined;
    const capture = (handler: () => void): number => {
      tick = handler;
      return 0;
    };
    vi.spyOn(window, "setInterval").mockImplementation(
      capture as unknown as typeof window.setInterval,
    );
    return () => tick();
  }

  it("주기 타이머가 조금씩 늦게 불려 앞 확인과의 간격이 30분에 조금 모자라도 확인한다", () => {
    stubLocation();
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const tick = captureIntervalTick();
    const update = vi.fn(async () => {});
    const registeredAt = now;
    registerWith(update);

    now = registeredAt + 30 * 60_000 + 5;
    tick();
    now = registeredAt + 60 * 60_000 + 2;
    tick();

    expect(update).toHaveBeenCalledTimes(2);
  });

  it("기기 시계가 뒤로 고쳐져도 30분마다 확인한다", () => {
    stubLocation();
    let wall = 1_800_000_000_000;
    let elapsed = 0;
    vi.spyOn(Date, "now").mockImplementation(() => wall);
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const tick = captureIntervalTick();
    const update = vi.fn(async () => {});
    registerWith(update);

    wall -= 2 * 60 * 60_000;
    elapsed += 30 * 60_000;
    wall += 30 * 60_000;
    tick();

    expect(update).toHaveBeenCalledTimes(1);
  });

  it("기기가 잠든 동안 performance.now()가 멈춰도 깨어나 탭이 보이면 확인한다", () => {
    stubLocation();
    let wall = 1_800_000_000_000;
    let elapsed = 0;
    vi.spyOn(Date, "now").mockImplementation(() => wall);
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    captureIntervalTick();
    const update = vi.fn(async () => {});
    registerWith(update);
    becomeHidden();

    wall += 2 * 60 * 60_000;
    elapsed += 60_000;
    becomeVisible();

    expect(update).toHaveBeenCalledTimes(1);
  });

  it("보이는 탭은 30분마다 새 버전을 확인한다", () => {
    vi.useFakeTimers();
    stubLocation();
    const update = vi.fn(async () => {});
    registerWith(update);

    vi.advanceTimersByTime(30 * 60_000);
    expect(update).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30 * 60_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("탭이 다시 보이면 지난 확인에서 30분이 지났을 때 새 버전을 확인한다", () => {
    vi.useFakeTimers();
    stubLocation();
    const update = vi.fn(async () => {});
    registerWith(update);
    becomeHidden();

    vi.advanceTimersByTime(30 * 60_000);
    becomeVisible();

    expect(update).toHaveBeenCalledTimes(1);
  });

  it("페이지를 연 뒤 30분 안에는 탭을 오가도 다시 확인하지 않는다", () => {
    vi.useFakeTimers();
    stubLocation();
    const update = vi.fn(async () => {});
    registerWith(update);

    for (let i = 0; i < 10; i += 1) {
      becomeHidden();
      vi.advanceTimersByTime(30_000);
      becomeVisible();
    }

    expect(update).not.toHaveBeenCalled();
  });

  it("확인은 30분에 한 번만 하고 숨은 탭에서는 주기 확인도 건너뛴다", () => {
    vi.useFakeTimers();
    stubLocation();
    const update = vi.fn(async () => {});
    registerWith(update);
    vi.advanceTimersByTime(30 * 60_000);
    expect(update).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 10; i += 1) {
      becomeVisible();
      vi.advanceTimersByTime(30_000);
    }
    becomeHidden();
    vi.advanceTimersByTime(2 * 60 * 60_000);
    expect(update).toHaveBeenCalledTimes(1);

    becomeVisible();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("송출 화면에서는 새 버전을 확인하지 않는다", () => {
    vi.useFakeTimers();
    stubLocation("/present/p1/fullscreen");
    const update = vi.fn(async () => {});
    registerWith(update);

    vi.advanceTimersByTime(30 * 60_000);
    becomeVisible();

    expect(update).not.toHaveBeenCalled();
  });

  it("확인이 실패해도 오류를 던지지 않는다", async () => {
    vi.useFakeTimers();
    stubLocation();
    const update = vi.fn(async () => {
      throw new TypeError("offline");
    });
    registerWith(update);

    await vi.advanceTimersByTimeAsync(30 * 60_000);

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

  it("오프라인이면 새로고침이 브라우저 오류 화면으로 끝나므로 새로고침하지 않는다", () => {
    const reload = stubLocation("/editor/p1");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    reloadOnStaleChunk();

    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STALE_CHUNK_KEY)).toBeNull();
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

  it("등록하면 청크 로드 실패에 새로고침을 건다", () => {
    stubServiceWorker({ controlled: true });
    const reload = stubLocation("/editor/p1");
    registerServiceWorker(makeRegistrar().registrar);

    const error = new Error("Failed to load chunk /_next/static/chunks/a.js");
    window.dispatchEvent(new ErrorEvent("error", { error }));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("청크 로드 실패가 아닌 오류에는 새로고침하지 않는다", () => {
    stubServiceWorker({ controlled: true });
    const reload = stubLocation("/editor/p1");
    registerServiceWorker(makeRegistrar().registrar);

    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom") }));

    expect(reload).not.toHaveBeenCalled();
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
