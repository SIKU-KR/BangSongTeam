import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signInAsTestUser } from "../../test/sessionFixture";
import {
  closeOfflineDB,
  OFFLINE_DB_NAME,
  loadAllPresentations,
  savePresentation,
  getPersistenceError,
  clearPersistenceError,
} from "../../lib/storage";
import {
  hydrateFromStorage,
  flushPendingWrites,
  resetPresentationStore,
  createNewPresentation,
  updatePresentationTitle,
  listPresentations,
  getActivePresentation,
  canUndo,
  undo,
} from "./presentationStore";

async function resetDatabase(): Promise<void> {
  closeOfflineDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe("presentationStore 영속성", () => {
  beforeEach(async () => {
    localStorage.clear();
    clearPersistenceError();
    await resetDatabase();
    signInAsTestUser();
    resetPresentationStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    closeOfflineDB();
  });

  it("편집하면 활성 문서가 저장된다", async () => {
    await hydrateFromStorage();
    const before = createNewPresentation("임시").id;

    updatePresentationTitle("저장 확인용 제목");
    await flushPendingWrites();

    const { valid } = await loadAllPresentations();
    const saved = valid.find((p) => p.id === before);
    expect(saved?.title).toBe("저장 확인용 제목");
  });

  it("새 문서를 만들면 그 문서도 저장된다", async () => {
    await hydrateFromStorage();

    const created = createNewPresentation("새 예배 세트");
    await flushPendingWrites();

    const { valid } = await loadAllPresentations();
    expect(valid.map((p) => p.id)).toContain(created.id);
  });

  it("저장본이 있으면 시드 대신 저장본으로 복원한다", async () => {
    await hydrateFromStorage();
    const created = createNewPresentation("복원 대상");
    updatePresentationTitle("복원 대상");
    await flushPendingWrites();

    resetPresentationStore();
    await hydrateFromStorage();

    const restored = listPresentations().find((p) => p.id === created.id);
    expect(restored?.title).toBe("복원 대상");
  });

  it("빈 저장소에서 샘플을 자동 생성하지 않는다", async () => {
    await hydrateFromStorage();

    expect(listPresentations()).toHaveLength(0);
    await flushPendingWrites();

    const { valid } = await loadAllPresentations();
    expect(valid).toHaveLength(0);
  });

  it("다른 계정의 저장본은 싣지 않는다", async () => {
    await hydrateFromStorage();
    const mine = createNewPresentation("내 세트");
    await flushPendingWrites();

    signInAsTestUser("999999999999999999999");
    resetPresentationStore();
    await hydrateFromStorage();

    expect(listPresentations().map((p) => p.id)).not.toContain(mine.id);
    const { valid } = await loadAllPresentations();
    expect(valid.map((p) => p.id)).toContain(mine.id);
  });

  it("undo/redo 히스토리는 저장하지 않는다", async () => {
    await hydrateFromStorage();
    updatePresentationTitle("첫 제목");
    updatePresentationTitle("두 번째 제목");
    await flushPendingWrites();
    expect(canUndo()).toBe(true);

    resetPresentationStore();
    await hydrateFromStorage();

    expect(canUndo()).toBe(false);
    expect(undo()).toBe(false);
  });

  it("손상된 저장본이 있어도 나머지 문서는 복원한다", async () => {
    await hydrateFromStorage();
    const healthy = createNewPresentation("정상 문서");
    await flushPendingWrites();

    await savePresentation({
      id: "broken-doc",
      title: 123,
    } as unknown as ReturnType<typeof getActivePresentation>);

    resetPresentationStore();
    await hydrateFromStorage();

    expect(listPresentations().map((p) => p.id)).toContain(healthy.id);
    expect(listPresentations().map((p) => p.id)).not.toContain("broken-doc");
  });

  it("저장에 실패하면 경고 상태를 올리고 편집은 계속 가능하다", async () => {
    await hydrateFromStorage();
    createNewPresentation("임시");
    await flushPendingWrites();

    vi.stubGlobal("indexedDB", undefined);
    closeOfflineDB();

    updatePresentationTitle("저장 실패 상황");
    await flushPendingWrites();

    expect(getPersistenceError()?.kind).toBe("unavailable");
    expect(getActivePresentation().title).toBe("저장 실패 상황");
  });
});
