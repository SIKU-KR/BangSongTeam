import "@testing-library/jest-dom/vitest";

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
