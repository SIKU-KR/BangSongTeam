import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  API_ERRORS,
  laterThan,
  type Presentation,
  type PresentationChanges,
} from "#shared";
import { COMMON_COPY } from "#copy/common";
import {
  seedPresentationsIntoStorage,
  signInAsTestUser,
} from "../../test/sessionFixture";
import {
  loadAllPresentations,
  savePresentation,
  saveSharedPresentation,
  clearPersistenceError,
} from "../../lib/storage";
import {
  closeOfflineDB,
  getOfflineDB,
  OFFLINE_DB_NAME,
  type WorshipOfflineDB,
} from "../../lib/storage/db";
import { getPersistenceError } from "../../lib/storage/persistenceStatus";
import { __resetStorageChannelForTests } from "../../lib/storage/storageChannel";
import { installFakeBroadcastChannel } from "../../test/fakeBroadcastChannel";
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
  canEditPresentation,
  replaceWithServerDocument,
  removePresentationsLocally,
  reloadPresentationsFromStorage,
  markPresentationSynced,
  adoptServerPresentation,
} from "./presentationStore";
import {
  __resetLineageForTests,
  contentFingerprint,
  isKnownAncestor,
} from "../../lib/sync/presentationLineage";
import { relateVersions } from "../../lib/sync/mergeDocuments";
import {
  __resetServerDecksForTests,
  setOwnPresentationListener,
} from "../../lib/sync/presentationSync";
import { ownPresentationListener } from "../../lib/sync/ownPresentationListener";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import {
  __resetSyncSchedulerForTests,
  __setPusherForTests,
  flushPendingSync,
  hasPendingDocumentPush,
  isDocumentQueued,
  setSyncEnabled,
} from "../../lib/sync/syncScheduler";
import {
  mockDecks,
  SEED_PRESENTATIONS,
  SEED_USER_ID,
} from "../../test/presentationFixture";

const storageHooks = vi.hoisted(() => ({
  beforeSave: null as null | ((doc: unknown) => Promise<void>),
  afterLoad: null as null | (() => void),
}));

vi.mock("../../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage")>();
  const withHook =
    (save: (doc: Presentation) => Promise<void>) =>
    async (doc: Presentation): Promise<void> => {
      const hook = storageHooks.beforeSave;
      storageHooks.beforeSave = null;
      if (hook) await hook(doc);
      return save(doc);
    };
  return {
    ...actual,
    loadAllPresentations: vi.fn(actual.loadAllPresentations),
    loadPresentation: vi.fn(async (id: string) => {
      const record = await actual.loadPresentation(id);
      const hook = storageHooks.afterLoad;
      storageHooks.afterLoad = null;
      hook?.();
      return record;
    }),
    savePresentation: vi.fn(withHook(actual.savePresentation)),
    saveSharedPresentation: vi.fn(withHook(actual.saveSharedPresentation)),
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
    __resetLineageForTests();
    storageHooks.beforeSave = null;
    storageHooks.afterLoad = null;
    vi.mocked(savePresentation).mockClear();
    vi.mocked(saveSharedPresentation).mockClear();
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
      return [
        ...vi.mocked(savePresentation).mock.calls,
        ...vi.mocked(saveSharedPresentation).mock.calls,
      ]
        .map(([doc]) => doc.id)
        .sort();
    }

    function forgetWrites(): void {
      vi.mocked(savePresentation).mockClear();
      vi.mocked(saveSharedPresentation).mockClear();
    }

    it("서버에서 바뀐 세트만 저장소에 다시 쓴다", async () => {
      const [unchanged, localWon, newer, seededMoved, shared] =
        SEED_PRESENTATIONS;
      const moved = { ...seededMoved, folderId: "a00000000000000000001" };
      await seedPresentationsIntoStorage([unchanged, localWon, newer, moved]);
      await hydrateFromStorage();
      forgetWrites();

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
      forgetWrites();

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

    it("시각이 같아도 서버가 내용을 고친 세트는 다시 쓰고, 기준 판만 붙은 세트는 다시 쓰지 않는다", async () => {
      const [legacy, synced] = SEED_PRESENTATIONS;
      const clean = { ...synced, baseUpdatedAt: synced.updatedAt };
      await seedPresentationsIntoStorage([legacy, clean]);
      await hydrateFromStorage();
      forgetWrites();

      applyServerDocuments([
        serverCopy(legacy, { baseUpdatedAt: legacy.updatedAt }),
        serverCopy(clean, { title: "서버가 고친 제목" }),
      ]);
      await flushPendingWrites();

      expect(writtenIds()).toEqual([synced.id]);
      expect(getPresentationById(legacy.id)?.baseUpdatedAt).toBe(
        legacy.updatedAt,
      );
      const { valid } = await loadAllPresentations();
      expect(valid.find((p) => p.id === synced.id)?.title).toBe(
        "서버가 고친 제목",
      );
    });

    it("병합이 서버 판으로 바꾼 세트는 그 판에서 계보를 새로 시작한다", async () => {
      const [doc] = SEED_PRESENTATIONS;
      await seedPresentationsIntoStorage([doc]);
      await hydrateFromStorage();
      const server = serverCopy(doc, {
        title: "다른 기기의 판",
        updatedAt: "2026-09-30T00:00:00.000Z",
        baseUpdatedAt: "2026-09-30T00:00:00.000Z",
      });

      applyServerDocuments([server]);

      expect(isKnownAncestor(doc.id, contentFingerprint(doc))).toBe(false);
      expect(isKnownAncestor(doc.id, contentFingerprint(server))).toBe(true);
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
      forgetWrites();
      storageHooks.beforeSave = () =>
        Promise.reject(new DOMException("가득 참", "QuotaExceededError"));

      await hydrateFromStorage();
      await flushPendingWrites();

      expect(writtenIds()).toEqual([seed.id]);
      expect(getPersistenceError()?.kind).toBe("quota");
    });
  });

  describe("한 브라우저를 함께 쓰는 소유자와 공유받은 사람", () => {
    const LEADER = SEED_USER_ID;
    const MEMBER = OTHER_USER;

    async function leaderEditsOffline(): Promise<Presentation> {
      signInAsTestUser(LEADER);
      resetPresentationStore();
      await hydrateFromStorage();
      const created = createNewPresentation();
      updatePresentationTitle("로컬 수정");
      await flushPendingWrites();
      return getPresentationById(created.id)!;
    }

    async function signInAs(userId: string): Promise<void> {
      signInAsTestUser(userId);
      resetPresentationStore();
      await hydrateFromStorage();
    }

    it("공유받은 사람이 받은 사본이 소유자의 저장본을 덮지 않는다", async () => {
      const leaders = await leaderEditsOffline();

      await signInAs(MEMBER);
      replaceWithServerDocument({
        ...leaders,
        title: "서버",
        access: { ownerName: "인도자", memberId: MEMBER },
      });
      await flushPendingWrites();

      await signInAs(LEADER);
      const reloaded = getPresentationById(leaders.id);
      expect(reloaded?.title).toBe("로컬 수정");
      expect(reloaded && canEditPresentation(reloaded)).toBe(true);
    });

    it("공유받은 사람이 사본을 지워도 소유자의 저장본은 남는다", async () => {
      const leaders = await leaderEditsOffline();

      await signInAs(MEMBER);
      replaceWithServerDocument({
        ...leaders,
        title: "서버",
        access: { ownerName: "인도자", memberId: MEMBER },
      });
      await flushPendingWrites();
      await removePresentationsLocally([leaders.id]);

      const { valid } = await loadAllPresentations();
      expect(valid.find((p) => p.id === leaders.id)).toEqual(leaders);
    });

    it("공유받은 사본만 있던 자리는 사본을 지우면 비운다", async () => {
      const shared: Presentation = {
        ...SEED_PRESENTATIONS[0],
        userId: LEADER,
        access: { ownerName: "인도자", memberId: MEMBER },
      };
      await seedPresentationsIntoStorage([shared]);
      await signInAs(MEMBER);

      await removePresentationsLocally([shared.id]);

      const { valid } = await loadAllPresentations();
      expect(valid.map((p) => p.id)).not.toContain(shared.id);
    });

    it("소유자의 부팅 병합은 공유받은 사본만 있던 자리를 updatedAt과 folderId가 같아도 소유자 사본으로 바꿔 다음에도 편집할 수 있다", async () => {
      const owners: Presentation = {
        ...structuredClone(SEED_PRESENTATIONS[0]),
        userId: LEADER,
        folderId: null,
      };
      await seedPresentationsIntoStorage([
        { ...owners, access: { ownerName: "인도자", memberId: MEMBER } },
      ]);
      await signInAs(LEADER);
      expect(canEditPresentation(getPresentationById(owners.id)!)).toBe(false);

      applyServerDocuments([structuredClone(owners)]);
      await flushPendingWrites();
      await signInAs(LEADER);

      const reloaded = getPresentationById(owners.id);
      expect(reloaded && canEditPresentation(reloaded)).toBe(true);
      const { valid } = await loadAllPresentations();
      expect(valid.find((p) => p.id === owners.id)).toEqual(owners);
    });
  });

  describe("다른 탭이 쓴 저장본 다시 읽기", () => {
    const [FIRST, SECOND, THIRD] = SEED_PRESENTATIONS;

    function withExtraSong(doc: Presentation): Presentation {
      const deck = {
        ...structuredClone(mockDecks[3]),
        id: "2x0000000000000000001",
        presentationId: doc.id,
      };
      return {
        ...structuredClone(doc),
        items: [
          ...structuredClone(doc.items),
          {
            id: "3x0000000000000000001",
            presentationId: doc.id,
            deckId: deck.id,
            order: doc.items.length,
            deck,
          },
        ],
        updatedAt: "2026-10-01T00:00:00.000Z",
      };
    }

    async function writeFromOtherTab(record: unknown): Promise<void> {
      const db = await getOfflineDB();
      await db.put(
        "presentations",
        record as WorshipOfflineDB["presentations"]["value"],
      );
    }

    async function deleteFromOtherTab(id: string): Promise<void> {
      const db = await getOfflineDB();
      await db.delete("presentations", id);
    }

    async function storedById(id: string): Promise<Presentation | undefined> {
      const { valid } = await loadAllPresentations();
      return valid.find((doc) => doc.id === id);
    }

    beforeEach(async () => {
      await seedPresentationsIntoStorage([FIRST, SECOND]);
      await hydrateFromStorage();
      vi.mocked(savePresentation).mockClear();
      vi.mocked(saveSharedPresentation).mockClear();
    });

    it("다른 탭이 곡을 더한 저장본을 다시 읽으면, 이 탭에서 이름을 바꿔도 그 곡을 지킨다", async () => {
      const newer = withExtraSong(FIRST);
      await writeFromOtherTab(newer);

      await reloadPresentationsFromStorage([FIRST.id]);
      renamePresentation(FIRST.id, "이 탭에서 바꾼 이름");
      await flushPendingWrites();

      const stored = await storedById(FIRST.id);
      expect(stored?.title).toBe("이 탭에서 바꾼 이름");
      expect(stored?.items.map((item) => item.id)).toEqual(
        newer.items.map((item) => item.id),
      );
    });

    it("다른 탭에서 만든 세트를 목록 끝에 넣는다", async () => {
      const before = listPresentations().map((doc) => doc.id);
      await writeFromOtherTab(THIRD);

      await reloadPresentationsFromStorage([THIRD.id]);

      expect(getPresentationById(THIRD.id)).toEqual(THIRD);
      expect(listPresentations().map((doc) => doc.id)).toEqual([
        ...before,
        THIRD.id,
      ]);
    });

    it("다시 읽어 바꾼 세트는 되돌리기 기록을 지운다", async () => {
      openPresentation(FIRST.id);
      updatePresentationTitle("되돌릴 수 있던 제목");
      await flushPendingWrites();
      expect(canUndo()).toBe(true);
      await writeFromOtherTab(withExtraSong(getPresentationById(FIRST.id)!));

      await reloadPresentationsFromStorage([FIRST.id]);

      expect(canUndo()).toBe(false);
      expect(getActivePresentation().items).toHaveLength(
        FIRST.items.length + 1,
      );
    });

    it("이 탭이 아직 저장하지 않은 편집이 있는 세트는 바꾸지 않는다", async () => {
      await writeFromOtherTab(withExtraSong(FIRST));
      renamePresentation(FIRST.id, "아직 저장하지 않은 이름");

      await reloadPresentationsFromStorage([FIRST.id]);

      expect(getPresentationById(FIRST.id)?.title).toBe(
        "아직 저장하지 않은 이름",
      );
      expect(getPresentationById(FIRST.id)?.items).toHaveLength(
        FIRST.items.length,
      );
    });

    it("이 탭이 저장하는 중인 세트는 바꾸지 않는다", async () => {
      let release: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        storageHooks.beforeSave = () => {
          resolve();
          return new Promise<void>((done) => {
            release = done;
          });
        };
      });
      renamePresentation(FIRST.id, "저장하는 중인 이름");
      const writing = flushPendingWrites();
      await started;
      await writeFromOtherTab(withExtraSong(FIRST));

      await reloadPresentationsFromStorage([FIRST.id]);
      release();
      await writing;

      expect(getPresentationById(FIRST.id)?.title).toBe("저장하는 중인 이름");
      expect(getPresentationById(FIRST.id)?.items).toHaveLength(
        FIRST.items.length,
      );
    });

    it("이 탭이 아직 서버에 올리지 못한 세트는 바꾸지 않는다", async () => {
      __setPusherForTests(vi.fn(async () => undefined));
      setSyncEnabled(true);
      renamePresentation(FIRST.id, "올리기를 기다리는 이름");
      await flushPendingWrites();
      expect(isDocumentQueued(FIRST.id)).toBe(true);
      await writeFromOtherTab(withExtraSong(FIRST));

      await reloadPresentationsFromStorage([FIRST.id]);

      expect(getPresentationById(FIRST.id)?.title).toBe(
        "올리기를 기다리는 이름",
      );
    });

    it("읽는 동안 이 탭에서 고친 세트는 읽은 저장본으로 바꾸지 않는다", async () => {
      await writeFromOtherTab(withExtraSong(FIRST));

      const reloading = reloadPresentationsFromStorage([FIRST.id]);
      renamePresentation(FIRST.id, "읽는 동안 고친 이름");
      await reloading;

      expect(getPresentationById(FIRST.id)?.title).toBe("읽는 동안 고친 이름");
      expect(getPresentationById(FIRST.id)?.items).toHaveLength(
        FIRST.items.length,
      );
    });

    it("다른 탭에서 지운 세트는 메모리에서 빼고 대기 중인 push를 버린다", async () => {
      const pusher = vi.fn(async (doc: Presentation) => doc.id);
      __setPusherForTests(pusher);
      setSyncEnabled(true);
      openPresentation(FIRST.id);
      renamePresentation(FIRST.id, "지우기 전에 고친 이름");
      await flushPendingWrites();
      await deleteFromOtherTab(FIRST.id);

      await reloadPresentationsFromStorage([FIRST.id]);
      await flushPendingSync();

      expect(getPresentationById(FIRST.id)).toBeUndefined();
      expect(listPresentations().map((doc) => doc.id)).toEqual([SECOND.id]);
      expect(getActivePresentation().id).toBe(SECOND.id);
      expect(pusher).not.toHaveBeenCalled();
      expect(isDocumentQueued(FIRST.id)).toBe(false);
    });

    it("읽지 못한 저장본(새 버전이 쓴 모양)은 지운 것으로 보지 않고 메모리를 그대로 둔다", async () => {
      const before = getPresentationById(FIRST.id);
      await writeFromOtherTab({ ...FIRST, title: 42 });

      await reloadPresentationsFromStorage([FIRST.id]);

      expect(getPresentationById(FIRST.id)).toBe(before);
    });

    it("다른 계정의 저장본은 싣지 않는다", async () => {
      await writeFromOtherTab({ ...THIRD, userId: OTHER_USER });

      await reloadPresentationsFromStorage([THIRD.id]);

      expect(getPresentationById(THIRD.id)).toBeUndefined();
    });

    it("다시 읽기는 저장소에 쓰지도 서버에 올리지도 않는다", async () => {
      const pusher = vi.fn(async (doc: Presentation) => doc.id);
      __setPusherForTests(pusher);
      setSyncEnabled(true);
      await writeFromOtherTab(withExtraSong(FIRST));
      await deleteFromOtherTab(SECOND.id);

      await reloadPresentationsFromStorage([FIRST.id, SECOND.id]);
      await flushPendingWrites();
      await flushPendingSync();

      expect(savePresentation).not.toHaveBeenCalled();
      expect(saveSharedPresentation).not.toHaveBeenCalled();
      expect(pusher).not.toHaveBeenCalled();
      expect(hasPendingDocumentPush()).toBe(false);
    });

    it("읽는 동안 다시 읽기를 멈추면 세트를 바꾸거나 빼지 않고 읽은 id를 돌려준다", async () => {
      const pusher = vi.fn(async (doc: Presentation) => doc.id);
      __setPusherForTests(pusher);
      setSyncEnabled(true);
      renamePresentation(SECOND.id, "올리기를 기다리는 이름");
      await flushPendingWrites();
      await writeFromOtherTab(withExtraSong(FIRST));
      await deleteFromOtherTab(SECOND.id);
      let paused = false;

      const reloading = reloadPresentationsFromStorage(
        [FIRST.id, SECOND.id],
        () => paused,
      );
      paused = true;
      const held = await reloading;
      await flushPendingSync();

      expect(held).toEqual([FIRST.id, SECOND.id]);
      expect(getPresentationById(FIRST.id)?.items).toHaveLength(
        FIRST.items.length,
      );
      expect(getPresentationById(SECOND.id)?.title).toBe(
        "올리기를 기다리는 이름",
      );
      expect(pusher).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: SECOND.id }),
      );
      expect(
        await reloadPresentationsFromStorage([FIRST.id], () => false),
      ).toEqual([]);
    });

    it("다른 탭이 남긴 기준 판을 함께 싣는다", async () => {
      const newer = {
        ...withExtraSong(FIRST),
        baseUpdatedAt: "2026-10-01T00:00:00.000Z",
      };
      await writeFromOtherTab(newer);

      await reloadPresentationsFromStorage([FIRST.id]);

      expect(getPresentationById(FIRST.id)).toEqual(newer);
    });

    describe("기준 판으로 고르기", () => {
      const T1 = "2026-09-25T00:00:00.000Z";
      const T2 = "2026-09-26T00:00:00.000Z";
      const T3 = "2026-09-27T00:00:00.000Z";

      async function hydrateWith(doc: Presentation): Promise<void> {
        await seedPresentationsIntoStorage([doc, SECOND]);
        await hydrateFromStorage();
        vi.mocked(savePresentation).mockClear();
      }

      it("더 오래된 기준 판의 맞춘 저장본은 이 탭의 더 새로운 맞춘 판을 바꾸지 않고, 이 탭의 판을 다시 저장한다", async () => {
        const current = {
          ...FIRST,
          title: "서버가 나중에 확정한 판",
          updatedAt: T3,
          baseUpdatedAt: T3,
        };
        await hydrateWith(current);
        await writeFromOtherTab({
          ...FIRST,
          updatedAt: T1,
          baseUpdatedAt: T1,
        });

        await reloadPresentationsFromStorage([FIRST.id]);
        await flushPendingWrites();

        expect(getPresentationById(FIRST.id)).toEqual(current);
        expect(await storedById(FIRST.id)).toEqual(current);
      });

      it("다른 탭의 올리지 않은 편집은 이 탭의 맞춘 판을 바꾼다", async () => {
        await hydrateWith({ ...FIRST, updatedAt: T2, baseUpdatedAt: T2 });
        const edited = {
          ...withExtraSong(FIRST),
          updatedAt: T3,
          baseUpdatedAt: T1,
        };
        await writeFromOtherTab(edited);

        await reloadPresentationsFromStorage([FIRST.id]);

        expect(getPresentationById(FIRST.id)).toEqual(edited);
      });

      it("올리기를 기다리느라 다른 탭의 저장본을 건너뛰었으면, 올린 뒤 맞춘 판을 쓰지 않고 그 저장본을 다시 읽는다", async () => {
        await hydrateWith({ ...FIRST, updatedAt: T1, baseUpdatedAt: T1 });
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        __setPusherForTests(async (doc: Presentation) => {
          await gate;
          markPresentationSynced(doc.id, doc, T2);
        });
        setSyncEnabled(true);
        renamePresentation(FIRST.id, "이 탭에서 바꾼 이름");
        await flushPendingWrites();
        const otherTab = {
          ...getPresentationById(FIRST.id)!,
          title: "다른 탭에서 바꾼 이름",
          updatedAt: T3,
        };
        await writeFromOtherTab(otherTab);
        await reloadPresentationsFromStorage([FIRST.id]);
        expect(getPresentationById(FIRST.id)?.title).toBe(
          "이 탭에서 바꾼 이름",
        );

        const pushing = flushPendingSync();
        release();
        await pushing;
        await vi.waitFor(() =>
          expect(getPresentationById(FIRST.id)?.title).toBe(
            "다른 탭에서 바꾼 이름",
          ),
        );
        await flushPendingWrites();

        expect(await storedById(FIRST.id)).toEqual(otherTab);
      });

      it("이 탭이 저장한 판과 다시 읽은 판으로 계보를 맞춘다", async () => {
        await hydrateWith({ ...FIRST, updatedAt: T1, baseUpdatedAt: T1 });
        expect(isKnownAncestor(FIRST.id, contentFingerprint(FIRST))).toBe(true);

        renamePresentation(FIRST.id, "저장한 이름");
        await flushPendingWrites();
        const saved = getPresentationById(FIRST.id)!;
        expect(isKnownAncestor(FIRST.id, contentFingerprint(saved))).toBe(true);

        const otherTab = { ...withExtraSong(FIRST), baseUpdatedAt: T1 };
        await writeFromOtherTab(otherTab);
        await reloadPresentationsFromStorage([FIRST.id]);

        expect(isKnownAncestor(FIRST.id, contentFingerprint(saved))).toBe(
          false,
        );
        expect(isKnownAncestor(FIRST.id, contentFingerprint(otherTab))).toBe(
          true,
        );
      });

      describe("다른 탭의 저장본을 건너뛰어 미룬 서버 판 받기", () => {
        const OTHER_DEVICE_TITLE = "다른 기기에서 바꾼 이름";

        function otherDeviceCopy(): Presentation {
          return {
            ...structuredClone(FIRST),
            title: OTHER_DEVICE_TITLE,
            updatedAt: T2,
          };
        }

        async function skipOtherTabWhileQueued(
          edit: () => void,
        ): Promise<void> {
          await hydrateWith({ ...FIRST, updatedAt: T1, baseUpdatedAt: T1 });
          setSyncEnabled(true);
          edit();
          await flushPendingWrites();
          await writeFromOtherTab({
            ...getPresentationById(FIRST.id)!,
            title: "다른 탭에서 바꾼 이름",
          });
          await reloadPresentationsFromStorage([FIRST.id]);
        }

        beforeEach(() => {
          __setPusherForTests(vi.fn(async () => undefined));
        });

        it("다시 읽는 동안 고쳐 다시 읽기를 마치지 못하면, 그 서버 판을 이 탭이 만든 판으로 알지 않는다", async () => {
          await skipOtherTabWhileQueued(() =>
            renamePresentation(FIRST.id, "이 탭에서 바꾼 이름"),
          );
          const server = otherDeviceCopy();
          storageHooks.afterLoad = () =>
            renamePresentation(FIRST.id, "다시 읽는 동안 고친 이름");

          adoptServerPresentation(server);
          await vi.waitFor(() =>
            expect(getPresentationById(FIRST.id)?.title).toBe(
              "다시 읽는 동안 고친 이름",
            ),
          );
          await flushPendingWrites();

          const current = getPresentationById(FIRST.id)!;
          expect(isKnownAncestor(FIRST.id, contentFingerprint(server))).toBe(
            false,
          );
          expect(
            relateVersions(current, server, (fingerprint) =>
              isKnownAncestor(FIRST.id, fingerprint),
            ),
          ).toBe("diverged");
        });

        it("저장본을 읽지 못해 다시 읽기를 마치지 못하면 이 탭의 판과 되돌리기 기록을 그대로 둔다", async () => {
          await skipOtherTabWhileQueued(() => {
            openPresentation(FIRST.id);
            updatePresentationTitle("이 탭에서 바꾼 이름");
          });
          await writeFromOtherTab({ ...FIRST, title: 42 });
          const before = getPresentationById(FIRST.id);
          const server = otherDeviceCopy();
          let loaded = false;
          storageHooks.afterLoad = () => {
            loaded = true;
          };

          adoptServerPresentation(server);
          await vi.waitFor(() => expect(loaded).toBe(true));

          expect(getPresentationById(FIRST.id)).toBe(before);
          expect(canUndo()).toBe(true);
          expect(isKnownAncestor(FIRST.id, contentFingerprint(server))).toBe(
            false,
          );
        });

        describe("올리기 결과로", () => {
          let fake: FakeApi;
          let stored: Presentation;

          beforeEach(() => {
            __setPusherForTests(null);
            __resetServerDecksForTests();
            stored = otherDeviceCopy();
            fake = installFakeApi({
              "PATCH /api/presentations/*": ({ body }) => {
                const changes = body as PresentationChanges;
                if (changes.id !== FIRST.id) {
                  return { body: { ok: true, updatedAt: changes.updatedAt } };
                }
                if (changes.baseUpdatedAt !== stored.updatedAt) {
                  return {
                    status: 412,
                    body: {
                      error: API_ERRORS.presentation.conflict,
                      presentation: stored,
                    },
                  };
                }
                stored = {
                  ...stored,
                  title: changes.title,
                  updatedAt: laterThan(stored.updatedAt, changes.updatedAt),
                };
                return { body: { ok: true, updatedAt: stored.updatedAt } };
              },
            });
            setOwnPresentationListener(ownPresentationListener);
          });

          afterEach(() => {
            setOwnPresentationListener(null);
            fake.restore();
          });

          it("엇갈린 세트를 다시 읽는 동안 고치면, 다시 보낼 때 다른 기기의 판을 덮지 않고 사본을 하나 더 남긴다", async () => {
            await skipOtherTabWhileQueued(() =>
              renamePresentation(FIRST.id, "이 탭에서 바꾼 이름"),
            );
            storageHooks.afterLoad = () =>
              renamePresentation(FIRST.id, "다시 읽는 동안 고친 이름");

            await flushPendingSync();
            await vi.waitFor(() =>
              expect(getPresentationById(FIRST.id)?.title).toBe(
                "다시 읽는 동안 고친 이름",
              ),
            );
            await flushPendingWrites();
            await flushPendingSync();

            expect(
              fake.calls
                .map(({ body }) => body as PresentationChanges)
                .filter((changes) => changes.id === FIRST.id)
                .map((changes) => [changes.title, changes.baseUpdatedAt]),
            ).toEqual([
              ["이 탭에서 바꾼 이름", T1],
              ["다시 읽는 동안 고친 이름", T1],
            ]);
            expect(stored.title).toBe(OTHER_DEVICE_TITLE);
            expect(
              listPresentations()
                .map((doc) => doc.title)
                .filter((title) => title.endsWith(COMMON_COPY.copySuffix)),
            ).toEqual([
              `이 탭에서 바꾼 이름${COMMON_COPY.copySuffix}`,
              `다시 읽는 동안 고친 이름${COMMON_COPY.copySuffix}`,
            ]);
            expect(getPresentationById(FIRST.id)).toMatchObject({
              title: OTHER_DEVICE_TITLE,
              updatedAt: T2,
              baseUpdatedAt: T2,
            });
          });
        });
      });
    });
  });

  describe("다른 탭에 알리기", () => {
    const CHANNEL = "chiton:storage";
    let tabs: ReturnType<typeof installFakeBroadcastChannel>;

    function nextTask(): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }

    beforeEach(() => {
      tabs = installFakeBroadcastChannel();
      __resetStorageChannelForTests();
    });

    afterEach(() => {
      __resetStorageChannelForTests();
    });

    it("세트를 저장소에 쓰거나 지운 뒤에 그 id를 알린다", async () => {
      const other = tabs.otherTab(CHANNEL);
      await hydrateFromStorage();

      const created = createNewPresentation();
      await nextTask();
      expect(other.received).toEqual([]);

      await flushPendingWrites();
      await removePresentationsLocally([created.id]);
      await nextTask();

      const change = {
        v: 1,
        userId: SEED_USER_ID,
        kind: "presentations",
        ids: [created.id],
      };
      expect(other.received).toEqual([change, change]);
      other.close();
    });

    it("저장소에 쓰지 못한 세트는 알리지 않는다", async () => {
      const other = tabs.otherTab(CHANNEL);
      await hydrateFromStorage();
      storageHooks.beforeSave = () =>
        Promise.reject(new DOMException("가득 참", "QuotaExceededError"));

      createNewPresentation();
      await flushPendingWrites();
      await nextTask();

      expect(other.received).toEqual([]);
      other.close();
    });
  });
});
