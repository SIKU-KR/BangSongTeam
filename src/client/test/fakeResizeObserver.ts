import { vi } from "vitest";

const liveObservers = new Set<FakeResizeObserver>();

class FakeResizeObserver {
  readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.targets.add(target);
    liveObservers.add(this);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    liveObservers.delete(this);
  }

  notify(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

interface InstalledResizeObserver {
  /** 지금 관찰 중인 요소들 */
  observed: () => Element[];
  /** 브라우저가 레이아웃을 마친 뒤 하듯, 관찰 중인 곳 모두에 크기가 바뀌었다고 알린다 */
  notify: () => void;
}

/**
 * `ResizeObserver`를 직접 울릴 수 있는 대역으로 바꾼다. jsdom에는 레이아웃이 없어 진짜는 울리지 않고
 * 구현도 없다. 요소의 크기는 시험이 `clientHeight` 같은 값으로 정하고, 바뀌었다는 알림만 `notify`로
 * 보낸다. `vi.unstubAllGlobals()`로 되돌린다.
 */
export function installFakeResizeObserver(): InstalledResizeObserver {
  liveObservers.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return {
    observed: () => [...liveObservers].flatMap((o) => [...o.targets]),
    notify: () => {
      for (const observer of [...liveObservers]) observer.notify();
    },
  };
}
