import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { installFakeCacheStorage } from "./fakeCacheStorage";

installFakeCacheStorage();

const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string): string | null => store[key] ?? null,
  setItem: (key: string, value: string): void => {
    store[key] = String(value);
  },
  removeItem: (key: string): void => {
    delete store[key];
  },
  clear: (): void => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
  },
  key: (index: number): string | null => Object.keys(store)[index] ?? null,
  get length(): number {
    return Object.keys(store).length;
  },
};

Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
