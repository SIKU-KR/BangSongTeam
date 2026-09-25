import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { eq, inArray } from "drizzle-orm";
import {
  DEFAULT_DECK_STYLE,
  PresentationDocumentSchema,
  type Folder,
  type PresentationDocument,
} from "#shared";
import {
  createD1Client,
  decks,
  driveTombstones,
  folders,
  presentationItems,
  presentations,
  user,
} from "#db";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";
import { clearTables } from "../test/db";

const USER_A = "aaaaaaaa00000000000f1";
const USER_B = "bbbbbbbb00000000000f2";

let currentUser: string | null = USER_A;
const fakeSession: SessionReader = async () =>
  currentUser ? { userId: currentUser } : null;

const app = createApp({ readSession: fakeSession });

let seq = 0;
function nextId(): string {
  seq += 1;
  return `f10000000${String(seq).padStart(12, "0")}`;
}

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: nextId(),
    userId: USER_A,
    parentId: null,
    name: "2026 주일",
    trashedAt: null,
    createdAt: "2026-09-24T00:00:00.123Z",
    updatedAt: "2026-09-24T00:00:00.456Z",
    ...overrides,
  };
}

function makeDoc(folderId: string | null): PresentationDocument {
  const id = nextId();
  const deckId = nextId();
  return PresentationDocumentSchema.parse({
    id,
    userId: USER_A,
    title: "주일 예배",
    serviceDate: "2026-09-27",
    folderId,
    items: [
      {
        id: nextId(),
        presentationId: id,
        deckId,
        order: 0,
        deck: {
          id: deckId,
          userId: USER_A,
          scope: "presentation",
          presentationId: id,
          title: "은혜로다",
          artist: "",
          lyricsRaw: "시작됐네",
          slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
          backgroundId: null,
          style: DEFAULT_DECK_STYLE,
          visibility: "private",
          createdAt: "2026-09-20T00:00:00.000Z",
          updatedAt: "2026-09-21T00:00:00.000Z",
        },
      },
    ],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

function put(body: unknown) {
  return {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function putFolder(folder: Folder): Promise<Response> {
  return app.request(`/api/folders/${folder.id}`, put(folder), env);
}

interface FolderListBody {
  folders: Folder[];
  tombstones: { folderIds: string[]; presentationIds: string[] };
}

async function listFolderBody(): Promise<FolderListBody> {
  const res = await app.request("/api/folders", {}, env);
  return (await res.json()) as FolderListBody;
}

async function listFolders(): Promise<Folder[]> {
  return (await listFolderBody()).folders;
}

async function listDocs(): Promise<PresentationDocument[]> {
  const res = await app.request("/api/presentations", {}, env);
  return ((await res.json()) as { presentations: PresentationDocument[] })
    .presentations;
}

describe("드라이브 폴더 API", () => {
  beforeEach(async () => {
    await clearTables(
      presentationItems,
      decks,
      presentations,
      folders,
      driveTombstones,
    );
    await createD1Client(env.DB)
      .delete(user)
      .where(inArray(user.id, [USER_A, USER_B]));
    await createD1Client(env.DB)
      .insert(user)
      .values([
        { id: USER_A, name: "A", createdAt: new Date(), updatedAt: new Date() },
        { id: USER_B, name: "B", createdAt: new Date(), updatedAt: new Date() },
      ]);
    currentUser = USER_A;
  });

  it("로그인하지 않으면 401", async () => {
    currentUser = null;
    const res = await app.request("/api/folders", {}, env);
    expect(res.status).toBe(401);
  });

  it("중첩 폴더를 저장하고 다른 기기에서 그대로 받는다 (ms 보존)", async () => {
    const parent = makeFolder({ name: "2026" });
    const child = makeFolder({ name: "주일", parentId: parent.id });

    expect((await putFolder(parent)).status).toBe(200);
    const res = await putFolder(child);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { folder: Folder }).folder).toEqual(child);

    const folders = await listFolders();
    expect(folders).toEqual([parent, child]);
  });

  it("경로와 본문 id가 다르면 400, 스키마 위반이면 400", async () => {
    const folder = makeFolder();
    const mismatch = await app.request(
      `/api/folders/${nextId()}`,
      put(folder),
      env,
    );
    expect(mismatch.status).toBe(400);

    const invalid = await putFolder({ ...folder, name: "   " });
    expect(invalid.status).toBe(400);
  });

  it("B는 A의 폴더를 보거나 고치거나 지우지 못한다", async () => {
    const folder = makeFolder();
    await putFolder(folder);

    currentUser = USER_B;
    expect(await listFolders()).toEqual([]);
    expect((await putFolder({ ...folder, name: "탈취" })).status).toBe(403);
    const del = await app.request(
      `/api/folders/${folder.id}`,
      { method: "DELETE" },
      env,
    );
    expect(del.status).toBe(404);

    currentUser = USER_A;
    const [still] = await listFolders();
    expect(still.name).toBe("2026 주일");
  });

  it("사이클을 만드는 이동은 루트로 보정해 돌려준다", async () => {
    const a = makeFolder({ name: "a" });
    const b = makeFolder({ name: "b", parentId: a.id });
    await putFolder(a);
    await putFolder(b);

    const res = await putFolder({ ...a, parentId: b.id });
    expect(res.status).toBe(200);
    const { folder } = (await res.json()) as { folder: Folder };
    expect(folder.parentId).toBeNull();
  });

  it("프레젠테이션을 폴더에 담고, 폴더 영구 삭제 시 하위까지 함께 지운다", async () => {
    const root = makeFolder({ name: "root" });
    const child = makeFolder({ name: "child", parentId: root.id });
    const keep = makeFolder({ name: "keep" });
    for (const folder of [root, child, keep]) await putFolder(folder);

    const inChild = makeDoc(child.id);
    const inKeep = makeDoc(keep.id);
    for (const doc of [inChild, inKeep]) {
      const res = await app.request(
        `/api/presentations/${doc.id}`,
        put(doc),
        env,
      );
      expect(res.status).toBe(200);
    }

    const del = await app.request(
      `/api/folders/${root.id}`,
      { method: "DELETE" },
      env,
    );
    expect(del.status).toBe(200);
    const body = (await del.json()) as {
      deletedFolderIds: string[];
      deletedPresentationIds: string[];
    };
    expect(body.deletedFolderIds.sort()).toEqual([root.id, child.id].sort());
    expect(body.deletedPresentationIds).toEqual([inChild.id]);

    const after = await listFolderBody();
    expect(after.folders.map((f) => f.id)).toEqual([keep.id]);
    expect(after.tombstones.folderIds.sort()).toEqual(
      [root.id, child.id].sort(),
    );
    expect(after.tombstones.presentationIds).toEqual([inChild.id]);
    const docs = await listDocs();
    expect(docs.map((d) => d.id)).toEqual([inKeep.id]);
    expect(docs[0].folderId).toBe(keep.id);
  });

  it("폴더 행이 사라지면 외래키가 파일을 루트로 떨어뜨린다 (SET NULL 안전망)", async () => {
    const folder = makeFolder();
    await putFolder(folder);
    const doc = makeDoc(folder.id);
    await app.request(`/api/presentations/${doc.id}`, put(doc), env);

    await createD1Client(env.DB)
      .delete(folders)
      .where(eq(folders.id, folder.id));

    const [restored] = await listDocs();
    expect(restored.id).toBe(doc.id);
    expect(restored.folderId).toBeNull();
  });

  it("남의 폴더를 가리키는 프레젠테이션은 루트로 보정된다", async () => {
    currentUser = USER_B;
    const theirs = makeFolder({ userId: USER_B });
    await putFolder(theirs);

    currentUser = USER_A;
    const doc = makeDoc(theirs.id);
    const res = await app.request(
      `/api/presentations/${doc.id}`,
      put(doc),
      env,
    );
    expect(res.status).toBe(200);
    const [restored] = await listDocs();
    expect(restored.folderId).toBeNull();
  });
});
