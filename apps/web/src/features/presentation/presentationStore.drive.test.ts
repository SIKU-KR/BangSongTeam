import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PresentationDocumentSchema, type Presentation } from "@repo/shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import { SEED_PRESENTATIONS } from "./mockPresentations";
import {
  __loadDocumentsForTests,
  createNewPresentation,
  duplicatePresentation,
  getActivePresentation,
  getActivePresentationId,
  getPresentationById,
  listPresentations,
  movePresentation,
  openPresentation,
  removePresentationsLocally,
  renamePresentation,
  resetPresentationStore,
  restorePresentation,
  trashPresentation,
  undo,
  redo,
  updatePresentationTitle,
} from "./presentationStore";
import {
  __resetSyncSchedulerForTests,
  __setPusherForTests,
  flushPendingSync,
  setSyncEnabled,
} from "../../lib/sync/syncScheduler";

const FOLDER = "f00000000000000000001";
const OTHER = "f00000000000000000002";

describe("presentationStore 드라이브 조작", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __resetSyncSchedulerForTests();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
  });

  afterEach(() => {
    __resetSyncSchedulerForTests();
  });

  it("새 프레젠테이션을 지정한 폴더에 만든다", () => {
    expect(createNewPresentation("세트", FOLDER).folderId).toBe(FOLDER);
    expect(createNewPresentation("세트").folderId).toBeNull();
  });

  it("활성 문서가 아니어도 id로 옮기고 이름을 바꾼다", () => {
    const target = SEED_PRESENTATIONS[3];
    expect(getActivePresentationId()).not.toBe(target.id);

    movePresentation(target.id, FOLDER);
    renamePresentation(target.id, "  바뀐 이름  ");

    const doc = getPresentationById(target.id);
    expect(doc?.folderId).toBe(FOLDER);
    expect(doc?.title).toBe("바뀐 이름");
    expect(doc!.updatedAt > target.updatedAt).toBe(true);
    // 활성 문서는 그대로다
    expect(getActivePresentationId()).toBe(SEED_PRESENTATIONS[0].id);
  });

  it("빈 이름으로는 바꾸지 않는다", () => {
    const target = SEED_PRESENTATIONS[1];
    renamePresentation(target.id, "   ");
    expect(getPresentationById(target.id)?.title).toBe(target.title);
  });

  it("바뀐 문서를 서버 push 큐에 넣는다 (활성 문서가 아니어도)", async () => {
    const pushed: Presentation[] = [];
    __setPusherForTests(async (doc) => {
      pushed.push(doc);
      return true;
    });
    setSyncEnabled(true);

    movePresentation(SEED_PRESENTATIONS[2].id, FOLDER);
    await flushPendingSync();

    expect(pushed.map((doc) => doc.id)).toEqual([SEED_PRESENTATIONS[2].id]);
    expect(pushed[0].folderId).toBe(FOLDER);
  });

  it("휴지통에 넣고 복원한다 (폴더 배치는 호출자가 정한다)", () => {
    const target = SEED_PRESENTATIONS[1];
    movePresentation(target.id, FOLDER);
    trashPresentation(target.id);
    expect(getPresentationById(target.id)?.trashedAt).toBeTruthy();
    expect(getPresentationById(target.id)?.folderId).toBe(FOLDER);

    restorePresentation(target.id, null);
    expect(getPresentationById(target.id)).toMatchObject({
      trashedAt: null,
      folderId: null,
    });
  });

  it("사본은 새 id(프레젠테이션·항목·덱)로 같은 폴더에 만든다", () => {
    const source = SEED_PRESENTATIONS[0];
    movePresentation(source.id, FOLDER);

    const copy = duplicatePresentation(source.id);
    expect(copy).not.toBeNull();
    expect(copy!.title).toBe(`${source.title} (사본)`);
    expect(copy!.folderId).toBe(FOLDER);
    expect(copy!.id).not.toBe(source.id);

    const sourceDeckIds = new Set(source.items.map((i) => i.deck?.id));
    for (const item of copy!.items) {
      expect(item.presentationId).toBe(copy!.id);
      expect(item.deckId).toBe(item.deck?.id);
      expect(sourceDeckIds.has(item.deck?.id)).toBe(false);
      expect(item.deck?.presentationId).toBe(copy!.id);
    }
    // 서버가 받을 수 있는 문서다 (uuid 등)
    expect(PresentationDocumentSchema.safeParse(copy).success).toBe(true);
    expect(listPresentations()).toHaveLength(SEED_PRESENTATIONS.length + 1);
  });

  it("사본 제목은 100자를 넘지 않는다", () => {
    const source = SEED_PRESENTATIONS[0];
    renamePresentation(source.id, "가".repeat(100));
    const copy = duplicatePresentation(source.id);
    expect(copy!.title.length).toBeLessThanOrEqual(100);
    expect(copy!.title.endsWith(" (사본)")).toBe(true);
  });

  it("편집기 되돌리기는 드라이브 배치(폴더·휴지통)를 되돌리지 않는다", () => {
    const active = getActivePresentation();
    updatePresentationTitle("편집 1");
    movePresentation(active.id, FOLDER);

    undo();
    expect(getActivePresentation().title).toBe(active.title);
    expect(getActivePresentation().folderId).toBe(FOLDER);

    movePresentation(active.id, OTHER);
    redo();
    expect(getActivePresentation().title).toBe("편집 1");
    expect(getActivePresentation().folderId).toBe(OTHER);
  });

  it("영구 삭제된 문서를 지우고 활성 문서를 옮기며 대기 중인 push를 취소한다", async () => {
    const push = vi.fn(async () => true);
    __setPusherForTests(push);
    setSyncEnabled(true);

    const active = SEED_PRESENTATIONS[0];
    openPresentation(active.id);
    renamePresentation(active.id, "지우기 전 수정");
    await removePresentationsLocally([active.id]);
    await flushPendingSync();

    expect(getPresentationById(active.id)).toBeUndefined();
    expect(getActivePresentationId()).toBe(SEED_PRESENTATIONS[1].id);
    expect(push).not.toHaveBeenCalled();
  });
});
