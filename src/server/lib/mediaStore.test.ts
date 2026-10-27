import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createFileMediaStore,
  createGcsMediaStore,
  createMediaStore,
} from "./mediaStore";

async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe("로컬 폴더 미디어 저장소", () => {
  let base: string;
  let root: string;

  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), "media-"));
    root = path.join(base, "media");
    await mkdir(path.join(root, "loops"), { recursive: true });
    await writeFile(path.join(root, "loops/a.mp4"), "0123456789");
    await writeFile(path.join(base, "outside.txt"), "secret");
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("크기·종류를 알려 주고 구간만 읽는다", async () => {
    const store = createFileMediaStore(root);
    const object = await store.stat("loops/a.mp4");
    expect(object).toMatchObject({ size: 10, contentType: "video/mp4" });
    expect(await text(store.read("loops/a.mp4", object!))).toBe("0123456789");
    expect(
      await text(store.read("loops/a.mp4", object!, { start: 2, end: 4 })),
    ).toBe("234");
  });

  it("없는 키, 폴더, 폴더 밖을 가리키는 키는 없는 객체다", async () => {
    const store = createFileMediaStore(root);
    expect(await store.stat("loops/missing.mp4")).toBeNull();
    expect(await store.stat("loops")).toBeNull();
    expect(await store.stat("../outside.txt")).toBeNull();
    expect(await store.stat("loops/../../outside.txt")).toBeNull();
  });

  it("MEDIA_BUCKET이 없으면 MEDIA_DIR 폴더를 쓴다", async () => {
    const store = createMediaStore({ MEDIA_DIR: root });
    expect((await store.stat("loops/a.mp4"))?.size).toBe(10);
  });
});

const OBJECT_SIZE = 8 * 1024 * 1024;
const CHUNK = Buffer.alloc(64 * 1024, 7);

interface FakeDownload {
  key: string;
  state: "streaming" | "finished" | "closed early";
}

function drainedOrClosed(res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.on("drain", done);
    res.on("close", done);
  });
}

async function serveFakeGcs(
  req: IncomingMessage,
  res: ServerResponse,
  downloads: FakeDownload[],
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://gcs.test");
  const key = decodeURIComponent(url.pathname.split("/o/").at(-1) ?? "");
  if (url.searchParams.get("alt") !== "media") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        name: key,
        bucket: "test",
        size: String(OBJECT_SIZE),
        generation: "1",
        etag: "etag-1",
        contentType: "video/mp4",
      }),
    );
    return;
  }

  const download: FakeDownload = { key, state: "streaming" };
  downloads.push(download);
  res.on("error", () => {});
  res.on("finish", () => {
    download.state = "finished";
  });
  res.on("close", () => {
    if (download.state === "streaming") download.state = "closed early";
  });
  res.writeHead(200, {
    "content-type": "video/mp4",
    "content-length": String(OBJECT_SIZE),
  });
  for (let sent = 0; sent < OBJECT_SIZE; sent += CHUNK.byteLength) {
    if (res.destroyed) return;
    if (!res.write(CHUNK)) await drainedOrClosed(res);
    await sleep(2);
  }
  res.end();
}

async function readAtLeast(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  bytes: number,
): Promise<number> {
  let received = 0;
  while (received < bytes) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
  }
  return received;
}

describe("Cloud Storage 미디어 저장소", () => {
  const downloads: FakeDownload[] = [];
  const downloadsOf = (key: string): FakeDownload[] =>
    downloads.filter((download) => download.key === key);
  let server: Server;
  let previousEmulatorHost: string | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      void serveFakeGcs(req, res, downloads);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    previousEmulatorHost = process.env.STORAGE_EMULATOR_HOST;
    process.env.STORAGE_EMULATOR_HOST = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (previousEmulatorHost === undefined) {
      delete process.env.STORAGE_EMULATOR_HOST;
    } else {
      process.env.STORAGE_EMULATOR_HOST = previousEmulatorHost;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("버킷 메타데이터로 크기·판·종류를 알려 준다", async () => {
    const store = createGcsMediaStore("test");

    expect(await store.stat("loops/meta.mp4")).toEqual({
      size: OBJECT_SIZE,
      etag: '"etag-1"',
      contentType: "video/mp4",
      version: "1",
    });
  });

  it("내려받기 하나를 취소해도 같은 프로세스의 다른 내려받기는 끝까지 받는다", async () => {
    const store = createGcsMediaStore("test");
    const [first, second] = await Promise.all([
      store.stat("loops/cancelled.mp4"),
      store.stat("loops/kept.mp4"),
    ]);
    const cancelled = store.read("loops/cancelled.mp4", first!).getReader();
    const kept = store.read("loops/kept.mp4", second!).getReader();

    await readAtLeast(cancelled, 256 * 1024);
    const head = await readAtLeast(kept, 256 * 1024);
    await cancelled.cancel(new Error("client gone"));

    expect(head + (await readAtLeast(kept, Infinity))).toBe(OBJECT_SIZE);
    await vi.waitFor(() => {
      expect(downloadsOf("loops/cancelled.mp4")).toEqual([
        { key: "loops/cancelled.mp4", state: "closed early" },
      ]);
      expect(downloadsOf("loops/kept.mp4")).toEqual([
        { key: "loops/kept.mp4", state: "finished" },
      ]);
    });
  });

  it("본문을 읽기 전에는 내려받기를 열지 않는다", async () => {
    const store = createGcsMediaStore("test");
    const object = await store.stat("loops/unread.mp4");

    const body = store.read("loops/unread.mp4", object!);
    await sleep(200);

    expect(downloadsOf("loops/unread.mp4")).toEqual([]);
    expect(await readAtLeast(body.getReader(), Infinity)).toBe(OBJECT_SIZE);
  });

  it("읽는 도중에 취소하면 기다리던 읽기를 끝내고 그 내려받기를 닫는다", async () => {
    const store = createGcsMediaStore("test");
    const object = await store.stat("loops/pending.mp4");
    const reader = store.read("loops/pending.mp4", object!).getReader();

    await readAtLeast(reader, 64 * 1024);
    const pending = reader.read();
    await reader.cancel(new Error("client gone"));

    expect(await pending).toEqual({ done: true, value: undefined });
    await vi.waitFor(() => {
      expect(downloadsOf("loops/pending.mp4")).toEqual([
        { key: "loops/pending.mp4", state: "closed early" },
      ]);
    });
  });

  it("읽기 전에 취소하면 내려받기를 열지 않는다", async () => {
    const store = createGcsMediaStore("test");
    const object = await store.stat("loops/never-read.mp4");
    const body = store.read("loops/never-read.mp4", object!);

    await expect(
      body.cancel(new Error("client gone")),
    ).resolves.toBeUndefined();
    await sleep(200);

    expect(downloadsOf("loops/never-read.mp4")).toEqual([]);
  });
});
