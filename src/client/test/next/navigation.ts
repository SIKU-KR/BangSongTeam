import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

/**
 * `next/navigation` 테스트 대역. 주소는 jsdom의 `window.history`에 두고, 이동하면
 * 구독한 훅을 다시 그린다. 동적 경로 값은 `TestParamsContext`로 받는다
 * (`src/client/test/router.tsx`가 채운다).
 */
const listeners = new Set<() => void>();

export type TestNavigationType = "POP" | "PUSH" | "REPLACE";

let lastNavigationType: TestNavigationType = "POP";

/** 마지막 이동이 push·replace·뒤로 가기 중 무엇이었는지 */
export function getLastNavigationType(): TestNavigationType {
  return lastNavigationType;
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

window.addEventListener("popstate", () => {
  lastNavigationType = "POP";
  notify();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface TestAppRouter {
  push: (href: string) => void;
  replace: (href: string) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
  prefetch: (href: string) => void;
}

export const testRouter: TestAppRouter = {
  push: (href) => {
    lastNavigationType = "PUSH";
    window.history.pushState(null, "", href);
    notify();
  },
  replace: (href) => {
    lastNavigationType = "REPLACE";
    window.history.replaceState(null, "", href);
    notify();
  },
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => {},
  prefetch: () => {},
};

/** 테스트가 `window.history`를 직접 바꾼 뒤 훅을 다시 그리게 한다 */
export function notifyLocationChange(): void {
  notify();
}

export const TestParamsContext = createContext<
  Record<string, string | undefined>
>({});

export function useRouter(): TestAppRouter {
  return testRouter;
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams<
  T extends Record<string, string | string[] | undefined>,
>(): T {
  return useContext(TestParamsContext) as T;
}

export function redirect(href: string): never {
  testRouter.replace(href);
  throw new Error(`redirect: ${href}`);
}

export function notFound(): never {
  throw new Error("notFound");
}
