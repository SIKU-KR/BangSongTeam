import { vi } from "vitest";

interface StubbedMatchMedia {
  /** 지금부터 이 쿼리들만 맞는 것으로 답하고, 값이 바뀐 쿼리를 듣는 쪽에 알린다 */
  match: (...queries: string[]) => void;
  /** 그 쿼리의 변화를 지금 듣고 있는 곳의 수 */
  listenerCount: (query: string) => number;
}

/**
 * `window.matchMedia`를 `queries`만 맞는 것으로 답하는 대역으로 바꾼다. jsdom에는 이 함수가 없어
 * `setup.ts`가 늘 `false`로 답하는 것을 채워 두므로, 화면 폭에 따라 그리는 내용이 달라지는 화면을
 * 시험할 때만 쓴다. `vi.restoreAllMocks()`로 되돌린다.
 */
export function stubMatchMedia(...queries: string[]): StubbedMatchMedia {
  let matching = new Set(queries);
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const forQuery =
      listeners.get(query) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.set(query, forQuery);
    return {
      get matches() {
        return matching.has(query);
      },
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (type === "change") forQuery.add(listener);
      },
      removeEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (type === "change") forQuery.delete(listener);
      },
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });

  return {
    listenerCount: (query) => listeners.get(query)?.size ?? 0,
    match: (...next) => {
      const previous = matching;
      matching = new Set(next);
      for (const [query, forQuery] of listeners) {
        if (previous.has(query) === matching.has(query)) continue;
        const event = new Event("change");
        for (const listener of [...forQuery]) {
          if (typeof listener === "function") listener(event);
          else listener.handleEvent(event);
        }
      }
    },
  };
}
