import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Presentation } from "#shared";
import {
  seedPresentationsIntoStorage,
  signInAsTestUser,
} from "../../test/sessionFixture";
import {
  loadAllPresentations,
  savePresentation,
  clearPersistenceError,
} from "../../lib/storage";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../../lib/storage/db";
import { getPersistenceError } from "../../lib/storage/persistenceStatus";
import {
  hydrateFromStorage,
  flushPendingWrites,
  resetPresentationStore,
  createNewPresentation,
  openPresentation,
  updatePresentationTitle,
  listPresentations,
  getActivePresentation,
  canUndo,
  undo,
  showSharedPreview,
  getPresentationById,
  applyServerDocuments,
  renamePresentation,
} from "./presentationStore";
import {
  __resetSyncSchedulerForTests,
  __setPusherForTests,
  flushPendingSync,
  hasPendingDocumentPush,
  setSyncEnabled,
} from "../../lib/sync/syncScheduler";
import {
  SEED_PRESENTATIONS,
  SEED_USER_ID,
} from "../../test/presentationFixture";

const storageHooks = vi.hoisted(() => ({
  beforeSave: null as null | ((doc: unknown) => Promise<void>),
}));

vi.mock("../../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage")>();
  return {
    ...actual,
    loadAllPresentations: vi.fn(actual.loadAllPresentations),
    savePresentation: vi.fn(async (doc: Presentation) => {
      const hook = storageHooks.beforeSave;
      storageHooks.beforeSave = null;
      if (hook) await hook(doc);
      return actual.savePresentation(doc);
    }),
  };
});

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
  const OTHER_USER = "999999999999999999999";

  beforeEach(async () => {
    localStorage.clear();
    clearPersistenceError();
    await resetDatabase();
    signInAsTestUser();
    resetPresentationStore();
    storageHooks.beforeSave = null;
    vi.mocked(savePresentation).mockClear();
    vi.mocked(loadAllPresentations).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetSyncSchedulerForTests();
    closeOfflineDB();
  });

  it("편집하면 활성 문서가 저장된다", async () => {
    await hydrateFromStorage();
    const before = createNewPresentation().id;

    updatePresentationTitle("저장 확인용 제목");
    await flushPendingWrites();

    const { valid } = await loadAllPresentations();
    const saved = valid.find((p) => p.id === before);
    expect(saved?.title).toBe("저장 확인용 제목");
  });

  it("로그인 없이 링크로 본 세트는 저장소에 남기지 않는다", async () => {
    await hydrateFromStorage();
    const preview = {
      ...SEED_PRESENTATIONS[0],
      id: "p0000000000000preview",
      access: { ownerName: "인도자" },
    };

    showSharedPreview(preview);
    await flushPendingWrites();

    expect(getPresentationById(preview.id)?.access).toEqual({
      ownerName: "인도자",
    });
    const { valid } = await loadAllPresentations();
    expect(valid.some((p) => p.id === preview.id)).toBe(false);
  });

  it("새 문서를 만들면 그 문서도 저장된다", async () => {
    await hydrateFromStorage();

    const created = createNewPresentation();
    await flushPendingWrites();

    const { valid } = await loadAllPresentations();
    expect(valid.map((p) => p.id)).toContain(created.id);
  });

  it("문서를 열기만 하면 저장소에 다시 쓰지 않는다", async () => {
    await hydrateFromStorage();
    const first = createNewPresentation();
    createNewPresentation();
    await flushPendingWrites();

    await savePresentation({ ...first, title: "다른 탭에서 바꾼 제목" });
    openPresentation(first.id);
    await flushPendingWrites();

    const { valid } = await loadAllPresentations();
    expect(valid.find((p) => p.id === first.id)?.title).toBe(
      "다른 탭에서 바꾼 제목",
    );
  });

  it("저장본이 있으면 시드 대신 저장본으로 복원한다", async () => {
    await hydrateFromStorage();
    const created = createNewPresentation();
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
    const mine = createNewPresentation();
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
    const healthy = createNewPresentation();
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
    createNewPresentation();
    await flushPendingWrites();

    vi.stubGlobal("indexedDB", undefined);
    closeOfflineDB();

    updatePresentationTitle("저장 실패 상황");
    await flushPendingWrites();

    expect(getPersistenceError()?.kind).toBe("unavailable");
    expect(getActivePresentation().title).toBe("저장 실패 상황");
  });

  describe("하이드레이션", () => {
    it("저장본을 읽지 못하면 부팅 병합이 서버 사본으로 덮지 않는다", async () => {
      const [seed] = SEED_PRESENTATIONS;
      await savePresentation({
        ...seed,
        title: "오프라인에서 고친 세트",
        updatedAt: "2026-09-30T00:00:00.000Z",
      });
      vi.mocked(loadAllPresentations).mockRejectedValueOnce(
        new DOMException(
          "Failed to read large IndexedDB value",
          "UnknownError",
        ),
      );
      await hydrateFromStorage();

      applyServerDocuments([{ ...seed, title: "서버 사본" }]);
      await flushPendingWrites();

      expect(getPresentationById(seed.id)?.title).toBe("서버 사본");
      const { valid } = await loadAllPresentations();
      expect(valid.find((p) => p.id === seed.id)?.title).toBe(
        "오프라인에서 고친 세트",
      );
    });

    it("다른 계정으로 바꿀 때 저장본을 읽지 못하면 앞 계정의 세트와 되돌리기 기록을 메모리에 남기지 않는다", async () => {
      await hydrateFromStorage();
      const previous = createNewPresentation();
      updatePresentationTitle("앞 계정의 세트");
      await flushPendingWrites();

      signInAsTestUser(OTHER_USER);
      vi.mocked(loadAllPresentations).mockRejectedValueOnce(
        new Error("읽기 실패"),
      );
      await hydrateFromStorage();

      expect(listPresentations()).toEqual([]);
      expect(getActivePresentation().id).toBe("");
      expect(getPersistenceError()).not.toBeNull();

      applyServerDocuments([
        { ...previous, access: { ownerName: "앞 계정", memberId: OTHER_USER } },
      ]);
      openPresentation(previous.id);
      expect(canUndo()).toBe(false);
    });

    it("저장본을 불러와도 열린 세트를 서버에 올리지 않는다", async () => {
      await seedPresentationsIntoStorage([
        { ...SEED_PRESENTATIONS[1], userId: OTHER_USER },
      ]);
      __setPusherForTests(vi.fn(async () => true));
      setSyncEnabled(true);

      signInAsTestUser(OTHER_USER);
      await hydrateFromStorage();

      expect(getActivePresentation().id).toBe(SEED_PRESENTATIONS[1].id);
      expect(hasPendingDocumentPush()).toBe(false);
    });
  });

  describe("부팅 병합 저장", () => {
    function serverCopy(
      doc: Presentation,
      changes: Partial<Presentation> = {},
    ): Presentation {
      return { ...structuredClone(doc), ...changes };
    }

    function writtenIds(): string[] {
      return vi
        .mocked(savePresentation)
        .mock.calls.map(([doc]) => doc.id)
        .sort();
    }

    it("서버에서 바뀐 세트만 저장소에 다시 쓴다", async () => {
      const [unchanged, localWon, newer, seededMoved, shared] =
        SEED_PRESENTATIONS;
      const moved = { ...seededMoved, folderId: "a00000000000000000001" };
      await seedPresentationsIntoStorage([unchanged, localWon, newer, moved]);
      await hydrateFromStorage();
      vi.mocked(savePresentation).mockClear();

      const created = serverCopy(newer, {
        id: "1x0000000000000000001",
        title: "다른 기기에서 만든 세트",
      });
      applyServerDocuments([
        serverCopy(unchanged),
        getPresentationById(localWon.id)!,
        serverCopy(newer, {
          title: "서버에서 고친 세트",
          updatedAt: "2026-09-30T00:00:00.000Z",
        }),
        serverCopy(moved, { folderId: null }),
        { ...serverCopy(shared), access: { ownerName: "인도자" } },
        created,
      ]);
      await flushPendingWrites();

      expect(writtenIds()).toEqual(
        [newer.id, moved.id, shared.id, created.id].sort(),
      );
      const { valid } = await loadAllPresentations();
      expect(valid.find((p) => p.id === newer.id)?.title).toBe(
        "서버에서 고친 세트",
      );
    });

    it("공유받은 세트는 updatedAt과 folderId가 같아도 다시 쓴다", async () => {
      const shared: Presentation = {
        ...SEED_PRESENTATIONS[4],
        userId: OTHER_USER,
        access: { ownerName: "인도자", memberId: SEED_USER_ID },
      };
      await seedPresentationsIntoStorage([shared]);
      await hydrateFromStorage();
      vi.mocked(savePresentation).mockClear();

      applyServerDocuments([
        serverCopy(shared, {
          access: { ownerName: "이름을 바꾼 인도자", memberId: SEED_USER_ID },
        }),
      ]);
      await flushPendingWrites();

      expect(writtenIds()).toEqual([shared.id]);
      const { valid } = await loadAllPresentations();
      expect(valid.find((p) => p.id === shared.id)?.access?.ownerName).toBe(
        "이름을 바꾼 인도자",
      );
    });

    it("지운 세트의 대기 중인 push와 저장을 버리고 저장본에서도 지운다", async () => {
      const pusher = vi.fn(async (doc: Presentation) => Boolean(doc.id));
      __setPusherForTests(pusher);
      setSyncEnabled(true);
      await hydrateFromStorage();
      const kept = createNewPresentation();
      const gone = createNewPresentation();
      await flushPendingWrites();

      renamePresentation(gone.id, "다른 기기에서 지운 세트");
      applyServerDocuments([getPresentationById(kept.id)!], [gone.id]);
      await flushPendingWrites();
      await flushPendingSync();

      expect(pusher.mock.calls.map(([doc]) => doc.id)).not.toContain(gone.id);
      expect(hasPendingDocumentPush()).toBe(false);
      const { valid } = await loadAllPresentations();
      expect(valid.map((p) => p.id)).toContain(kept.id);
      expect(valid.map((p) => p.id)).not.toContain(gone.id);
    });

    it("지운 세트는 이미 줄을 선 저장이 끝난 뒤에 지워 되살아나지 않는다", async () => {
      await hydrateFromStorage();
      const kept = createNewPresentation();
      const gone = createNewPresentation();
      await flushPendingWrites();

      let release: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        storageHooks.beforeSave = () => {
          resolve();
          return new Promise<void>((done) => {
            release = done;
          });
        };
      });
      renamePresentation(gone.id, "저장 중에 지운 세트");
      const writing = flushPendingWrites();
      await started;

      applyServerDocuments([getPresentationById(kept.id)!], [gone.id]);
      release();
      await writing;
      await flushPendingWrites();

      const { valid } = await loadAllPresentations();
      expect(valid.map((p) => p.id)).not.toContain(gone.id);
    });

    it("병합 결과에 있는 세트는 지운 목록에 있어도 저장본과 대기 중인 push를 남긴다", async () => {
      const pusher = vi.fn(async (doc: Presentation) => Boolean(doc.id));
      __setPusherForTests(pusher);
      setSyncEnabled(true);
      await hydrateFromStorage();
      const doc = createNewPresentation();
      await flushPendingWrites();

      renamePresentation(doc.id, "아직 올리지 않은 제목");
      applyServerDocuments([getPresentationById(doc.id)!], [doc.id]);
      await flushPendingWrites();
      await flushPendingSync();

      expect(listPresentations().map((p) => p.id)).toEqual([doc.id]);
      expect(pusher.mock.calls.map(([pushed]) => pushed.title)).toContain(
        "아직 올리지 않은 제목",
      );
      const { valid } = await loadAllPresentations();
      expect(valid.find((p) => p.id === doc.id)?.title).toBe(
        "아직 올리지 않은 제목",
      );
    });

    it("지운 세트의 되돌리기 기록을 버려 다시 받아도 되돌릴 수 없다", async () => {
      await hydrateFromStorage();
      const kept = createNewPresentation();
      const gone = createNewPresentation();
      updatePresentationTitle("지우기 전에 바꾼 제목");
      await flushPendingWrites();
      expect(canUndo()).toBe(true);
      const returned = getPresentationById(gone.id)!;

      applyServerDocuments([getPresentationById(kept.id)!], [gone.id]);
      applyServerDocuments([getPresentationById(kept.id)!, returned]);
      await flushPendingWrites();
      openPresentation(gone.id);

      expect(canUndo()).toBe(false);
    });

    it("저장소에 쓰지 못하면 경고를 올린다", async () => {
      await hydrateFromStorage();
      storageHooks.beforeSave = () =>
        Promise.reject(new DOMException("가득 참", "QuotaExceededError"));

      applyServerDocuments([SEED_PRESENTATIONS[0]]);
      await flushPendingWrites();

      expect(getPersistenceError()?.kind).toBe("quota");
    });

    it("하이드레이션이 고친 세트를 저장하지 못하면 경고를 올린다", async () => {
      const [seed] = SEED_PRESENTATIONS;
      const [first, second, ...rest] = seed.items;
      await seedPresentationsIntoStorage([
        {
          ...seed,
          userId: SEED_USER_ID,
          items: [
            first,
            {
              ...second,
              deckId: first.deckId,
              deck: { ...second.deck!, id: first.deckId },
            },
            ...rest,
          ],
        },
      ]);
      vi.mocked(savePresentation).mockClear();
      storageHooks.beforeSave = () =>
        Promise.reject(new DOMException("가득 참", "QuotaExceededError"));

      await hydrateFromStorage();
      await flushPendingWrites();

      expect(writtenIds()).toEqual([seed.id]);
      expect(getPersistenceError()?.kind).toBe("quota");
    });
  });
});
