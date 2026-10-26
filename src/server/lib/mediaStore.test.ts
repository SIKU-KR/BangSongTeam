import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileMediaStore, createMediaStore } from "./mediaStore";

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
