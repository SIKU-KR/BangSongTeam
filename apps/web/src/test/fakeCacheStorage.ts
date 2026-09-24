class FakeCache {
  private entries = new Map<string, Response>();

  private keyOf(request: RequestInfo | URL): string {
    if (typeof request === "string") return request;
    if (request instanceof URL) return request.toString();
    return (request as Request).url;
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const hit = this.entries.get(this.keyOf(request));
    return hit ? hit.clone() : undefined;
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(this.keyOf(request), response);
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.keyOf(request));
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => ({ url }) as Request);
  }

  get size(): number {
    return this.entries.size;
  }
}

class FakeCacheStorage {
  private caches = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache;
  }

  async has(name: string): Promise<boolean> {
    return this.caches.has(name);
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  reset(): void {
    this.caches.clear();
  }
}

export const fakeCaches = new FakeCacheStorage();

export function installFakeCacheStorage(): void {
  Object.defineProperty(globalThis, "caches", {
    value: fakeCaches,
    writable: true,
    configurable: true,
  });
}

export function resetFakeCacheStorage(): void {
  fakeCaches.reset();
}
