import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  onTestFinished,
  vi,
} from "vitest";
import {
  API_ERRORS,
  type Folder,
  type Presentation,
  type PresentationChanges,
} from "#shared";
import { ERROR_COPY } from "#copy/common";
import { signInAsTestUser } from "../../test/sessionFixture";
import {
  __loadDocumentsForTests,
  getPresentationById,
  movePresentation,
  resetPresentationStore,
} from "../../features/presentation/presentationStore";
import { ownPresentationListener } from "./ownPresentationListener";
import {
  scheduleDocumentPush,
  cancelDocumentPush,
  flushBeforeProjection,
  flushPendingSync,
  hasPendingDocumentPush,
  isDocumentPushCancelled,
  isDocumentQueued,
  retryPendingSyncNow,
  setSyncEnabled,
  SYNC_DEBOUNCE_MS,
  SYNC_MAX_WAIT_MS,
  __resetSyncSchedulerForTests,
  __setPusherForTests,
  __setBackoffRandomForTests,
} from "./syncScheduler";
import { BASE_BACKOFF_MS, MAX_RETRY_ATTEMPTS, SLOW_RETRY_MS } from "./backoff";
import { getSyncSnapshot, resetSyncStatus } from "./syncStatus";
import {
  __resetServerDecksForTests,
  setOwnPresentationListener,
} from "./presentationSync";
import {
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
  TimeoutError,
} from "../api/request";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import {
  scheduleFolderPush,
  flushFolderSync,
  pushFolderNow,
  setFolderSyncEnabled,
  __resetFolderSyncForTests,
  __setFolderBackoffRandomForTests,
  __setFolderPusherForTests,
} from "./folderSync";

const USER = "00000000x000000000001";
const FOLDER = "f00000000000000000001";

function newFolder(id = FOLDER): Folder {
  return {
    id,
    userId: USER,
    parentId: null,
    name: "새 폴더",
    trashedAt: null,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

function doc(id: string, title = "세트"): Presentation {
  return {
    id,
    userId: USER,
    title,
    serviceDate: "2026-09-27",
    items: [],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

describe("서버 push 스케줄러", () => {
  let push: ReturnType<typeof vi.fn<(doc: Presentation) => Promise<boolean>>>;

  beforeEach(() => {
    __resetSyncSchedulerForTests();
    resetSyncStatus();
    push = vi.fn(async () => true);
    __setPusherForTests(push);
    setSyncEnabled(true);
  });

  afterEach(() => {
    __resetSyncSchedulerForTests();
  });

  it("동기화가 꺼져 있으면 아무것도 보내지 않는다", async () => {
    setSyncEnabled(false);

    scheduleDocumentPush(doc("a"));
    await flushPendingSync();

    expect(push).not.toHaveBeenCalled();
  });

  it("예약한 문서를 flush 시 올린다", async () => {
    scheduleDocumentPush(doc("a"));
    await flushPendingSync();

    expect(push).toHaveBeenCalledTimes(1);
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("같은 문서를 연달아 고치면 한 번만 올린다 (디바운스)", async () => {
    scheduleDocumentPush(doc("a", "1"));
    scheduleDocumentPush(doc("a", "2"));
    scheduleDocumentPush(doc("a", "3"));
    await flushPendingSync();

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].title).toBe("3");
  });

  it("비활성 문서 변경도 큐에 남는다", async () => {
    scheduleDocumentPush(doc("a"));
    scheduleDocumentPush(doc("b"));
    await flushPendingSync();

    expect(push).toHaveBeenCalledTimes(2);
    const ids = push.mock.calls.map((c) => c[0].id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("id가 없는 자리표시자 문서는 올리지 않는다", async () => {
    scheduleDocumentPush(doc(""));
    await flushPendingSync();

    expect(push).not.toHaveBeenCalled();
  });

  it("오프라인이면 상태만 offline로 두고 큐에 되돌린다", async () => {
    push.mockRejectedValue(new OfflineError());

    scheduleDocumentPush(doc("a"));
    await flushPendingSync();

    expect(getSyncSnapshot().status).toBe("offline");

    push.mockResolvedValue(true);
    await flushPendingSync();
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("멈춘 요청으로 인해 타임아웃(TimeoutError)이 발생해도 syncing에 머물지 않고 offline으로 바뀐 뒤 재시도된다", async () => {
    push.mockRejectedValueOnce(new TimeoutError());

    scheduleDocumentPush(doc("a"));
    await flushPendingSync();

    expect(getSyncSnapshot().status).toBe("offline");

    push.mockResolvedValue(true);
    await flushPendingSync();
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("서버가 응답하지 않고 멈춘 경우 데드라인 뒤 offline 상태로 전환되고 재연결 시 정상 동기화된다", async () => {
    vi.useFakeTimers();
    __setPusherForTests(null);

    const waiter: { resolve?: () => void } = {};
    let shouldResolve = false;
    const fake = installFakeApi({
      "PATCH /api/presentations/*": () =>
        new Promise((resolve) => {
          if (shouldResolve) {
            resolve({ status: 200, body: { ok: true } });
            return;
          }
          waiter.resolve = () => {
            shouldResolve = true;
            resolve({ status: 200, body: { ok: true } });
          };
        }),
    });

    const validDocId = "100000000000000000001";
    scheduleDocumentPush(doc(validDocId));
    const flushPromise = flushPendingSync();
    await vi.advanceTimersByTimeAsync(0);

    expect(getSyncSnapshot().status).toBe("syncing");

    await vi.advanceTimersByTimeAsync(10_000);
    await flushPromise;

    expect(getSyncSnapshot().status).toBe("offline");

    shouldResolve = true;
    waiter.resolve?.();
    const nextFlush = flushPendingSync();
    await vi.advanceTimersByTimeAsync(0);
    await nextFlush;

    expect(getSyncSnapshot().status).toBe("synced");

    fake.restore();
    vi.useRealTimers();
  });

  it("서버가 거절하면 error로 표시한다", async () => {
    push.mockRejectedValue(new Error("403"));

    scheduleDocumentPush(doc("a"));
    await flushPendingSync();

    expect(getSyncSnapshot().status).toBe("error");
  });

  it("빈 큐를 flush해도 상태를 건드리지 않는다", async () => {
    await flushPendingSync();
    expect(getSyncSnapshot().status).toBe("idle");
  });

  it("프레젠테이션 동기화가 실패한 뒤 폴더 동기화가 성공해도 동기화 실패로 남는다", async () => {
    __resetFolderSyncForTests();
    __setFolderPusherForTests(async (folder) => folder);
    setFolderSyncEnabled(true);
    push.mockRejectedValue(new ServerRejectedError(400, "잘못된 문서 구조"));

    scheduleDocumentPush(doc("a", "불량 세트"));
    await flushPendingSync();
    expect(getSyncSnapshot().status).toBe("error");

    scheduleFolderPush({
      id: "f00000000000000000001",
      userId: USER,
      parentId: null,
      name: "새 폴더",
      trashedAt: null,
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
    });
    await flushFolderSync();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: "a",
      kind: "presentation",
    });
    __resetFolderSyncForTests();
  });

  it("다른 프레젠테이션이 성공해도 실패한 프레젠테이션이 다시 올라가기 전까지 실패로 남는다", async () => {
    push.mockImplementation(async (document) => {
      if (document.id === "a") throw new ServerRejectedError(400, "거절");
      return true;
    });

    scheduleDocumentPush(doc("a"));
    await flushPendingSync();
    scheduleDocumentPush(doc("b"));
    await flushPendingSync();
    expect(getSyncSnapshot().status).toBe("error");

    push.mockResolvedValue(true);
    scheduleDocumentPush(doc("a"));
    await flushPendingSync();
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
  });

  it("실패한 프레젠테이션을 영구 삭제하면 실패 표시를 지운다", async () => {
    push.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));

    scheduleDocumentPush(doc("a"));
    await flushPendingSync();
    expect(getSyncSnapshot().status).toBe("error");

    cancelDocumentPush("a");
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
  });

  it("보내는 중에 취소한 세트는 거절되거나 연결이 끊겨도 실패로 남기거나 다시 넣지 않는다", async () => {
    push.mockImplementationOnce(async () => {
      cancelDocumentPush("a");
      throw new ServerRejectedError(400, "거절");
    });
    push.mockImplementationOnce(async () => {
      cancelDocumentPush("b");
      throw new OfflineError();
    });

    scheduleDocumentPush(doc("a"));
    await flushPendingSync();
    scheduleDocumentPush(doc("b"));
    await flushPendingSync();
    retryPendingSyncNow("manual");
    await flushPendingSync();

    expect(push).toHaveBeenCalledTimes(2);
    expect(isDocumentQueued("a")).toBe(false);
    expect(isDocumentQueued("b")).toBe(false);
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
  });

  it("보내는 중에 취소한 세트는 그 push가 끝나거나 다시 넣을 때까지 취소한 것으로 본다", async () => {
    const releases: Array<() => void> = [];
    push.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          releases.push(() => resolve(true));
        }),
    );

    scheduleDocumentPush(doc("a"));
    const first = flushPendingSync();
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(isDocumentPushCancelled("a")).toBe(false);
    cancelDocumentPush("a");
    expect(isDocumentPushCancelled("a")).toBe(true);
    releases[0]();
    await first;
    expect(isDocumentPushCancelled("a")).toBe(false);

    scheduleDocumentPush(doc("a"));
    const second = flushPendingSync();
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(2));
    cancelDocumentPush("a");
    scheduleDocumentPush(doc("a"));
    expect(isDocumentPushCancelled("a")).toBe(false);
    releases[1]();
    await second;
    cancelDocumentPush("b");
    expect(isDocumentPushCancelled("b")).toBe(false);
  });

  it("대기 중이거나 보내는 중이거나 실패로 남은 세트를 큐에 있다고 본다", async () => {
    let release: () => void = () => undefined;
    push.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    push.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));

    expect(isDocumentQueued("a")).toBe(false);
    scheduleDocumentPush(doc("a"));
    expect(isDocumentQueued("a")).toBe(true);
    const flushing = flushPendingSync();
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(isDocumentQueued("a")).toBe(true);
    release();
    await flushing;
    expect(isDocumentQueued("a")).toBe(false);

    scheduleDocumentPush(doc("b"));
    await flushPendingSync();
    expect(isDocumentQueued("b")).toBe(true);
    cancelDocumentPush("b");
    expect(isDocumentQueued("b")).toBe(false);
  });

  describe("송출 화면", () => {
    const startPath = window.location.pathname;
    const PROJECTION_PATH = "/present/a00000000000000000001/fullscreen";

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      window.history.pushState({}, "", startPath);
    });

    it("송출 중에는 디바운스·flush·다시 시도로도 보내지 않고, 송출을 마치면 큐에 남은 세트를 보낸다", async () => {
      window.history.pushState({}, "", PROJECTION_PATH);

      scheduleDocumentPush(doc("a", "송출 직전에 고친 제목"));
      await vi.advanceTimersByTimeAsync(SYNC_MAX_WAIT_MS);
      await flushPendingSync();
      retryPendingSyncNow("manual");
      retryPendingSyncNow("reconnect");
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS * 3);

      expect(push).not.toHaveBeenCalled();
      expect(isDocumentQueued("a")).toBe(true);

      window.history.pushState({}, "", "/presentations");
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);

      expect(push).toHaveBeenCalledTimes(1);
      expect(push.mock.calls[0][0].title).toBe("송출 직전에 고친 제목");
      expect(getSyncSnapshot().status).toBe("synced");
    });

    it("송출 전에 나간 요청은 기다려 끝내고, 송출 중에 고친 판은 송출을 마친 뒤에 보낸다", async () => {
      let release: () => void = () => undefined;
      push.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            release = () => resolve(true);
          }),
      );
      scheduleDocumentPush(doc("a", "첫 판"));
      const first = flushPendingSync();
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

      window.history.pushState({}, "", PROJECTION_PATH);
      scheduleDocumentPush(doc("a", "송출 중에 고친 판"));
      const second = flushPendingSync();
      release();
      await Promise.all([first, second]);
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS * 3);

      expect(push).toHaveBeenCalledTimes(1);

      window.history.pushState({}, "", "/presentations");
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);

      expect(push.mock.calls.map(([sent]) => sent.title)).toEqual([
        "첫 판",
        "송출 중에 고친 판",
      ]);
    });

    it("송출 화면으로 가기 직전에 부르면 기다리는 세트를 디바운스·동시 개수 제한 없이 모두 보낸다", async () => {
      const ids = ["a", "b", "c", "d", "e"];
      for (const id of ids)
        scheduleDocumentPush(doc(id, "송출 직전에 고친 제목"));

      flushBeforeProjection();
      window.history.pushState({}, "", PROJECTION_PATH);
      await flushPendingSync();

      expect(push.mock.calls.map(([sent]) => sent.id).sort()).toEqual(ids);
      expect(hasPendingDocumentPush()).toBe(false);
      expect(getSyncSnapshot().status).toBe("synced");
    });

    it("이미 송출 중이면 송출 직전 보내기도 보내지 않는다", async () => {
      window.history.pushState({}, "", PROJECTION_PATH);
      scheduleDocumentPush(doc("a"));

      flushBeforeProjection();
      await flushPendingSync();
      await vi.advanceTimersByTimeAsync(SYNC_MAX_WAIT_MS);

      expect(push).not.toHaveBeenCalled();
      expect(isDocumentQueued("a")).toBe(true);
    });

    it("송출 직전에 보내는 중이던 세트의 새 판은 그 요청이 끝나고 송출을 마친 뒤에 보낸다", async () => {
      let release: () => void = () => undefined;
      push.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            release = () => resolve(true);
          }),
      );
      scheduleDocumentPush(doc("a", "첫 판"));
      const first = flushPendingSync();
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
      scheduleDocumentPush(doc("a", "송출 직전에 고친 판"));

      flushBeforeProjection();
      window.history.pushState({}, "", PROJECTION_PATH);
      release();
      await first;
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS * 3);

      expect(push).toHaveBeenCalledTimes(1);

      window.history.pushState({}, "", "/presentations");
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);

      expect(push.mock.calls.map(([sent]) => sent.title)).toEqual([
        "첫 판",
        "송출 직전에 고친 판",
      ]);
    });
  });

  it("새 폴더를 세트보다 먼저 올린다 (폴더 큐를 먼저 비운다)", async () => {
    __resetFolderSyncForTests();
    const order: string[] = [];
    __setFolderPusherForTests(async (folder) => {
      order.push(`folder:${folder.id}`);
      return folder;
    });
    push.mockImplementation(async (document) => {
      order.push(`doc:${document.id}`);
      return true;
    });
    setFolderSyncEnabled(true);

    scheduleFolderPush({
      id: "f00000000000000000001",
      userId: USER,
      parentId: null,
      name: "새 폴더",
      trashedAt: null,
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
    });
    scheduleDocumentPush({
      ...doc("a"),
      folderId: "f00000000000000000001",
    });
    await flushPendingSync();

    expect(order).toEqual(["folder:f00000000000000000001", "doc:a"]);
    __resetFolderSyncForTests();
  });

  it("담긴 폴더가 오르기를 기다리는 사이 다른 새 폴더로 옮긴 세트는 그 폴더가 오른 뒤에 옮긴 자리로 올린다", async () => {
    __resetFolderSyncForTests();
    signInAsTestUser(USER);
    const docId = "100000000000000000001";
    const first = newFolder("f00000000000000000001");
    const second = newFolder("f00000000000000000002");
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    __setFolderPusherForTests(async (folder) => {
      order.push(`folder:${folder.id}`);
      if (folder.id === first.id) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return folder;
    });
    const api = installFakeApi({
      "PATCH /api/presentations/*": ({ body }) => {
        const changes = body as PresentationChanges;
        order.push(`doc:${changes.folderId}`);
        return { body: { ok: true, updatedAt: changes.updatedAt } };
      },
    });
    onTestFinished(() => {
      setOwnPresentationListener(null);
      api.restore();
      resetPresentationStore();
      __resetFolderSyncForTests();
    });
    __setPusherForTests(null);
    setOwnPresentationListener(ownPresentationListener);
    setFolderSyncEnabled(true);
    __loadDocumentsForTests([
      { ...doc(docId), folderId: first.id, baseUpdatedAt: null },
    ]);

    scheduleFolderPush(first);
    scheduleDocumentPush(getPresentationById(docId)!);
    const flushing = flushPendingSync();
    await vi.waitFor(() => expect(order).toEqual([`folder:${first.id}`]));
    scheduleFolderPush(second);
    movePresentation(docId, second.id);
    releaseFirst();
    await flushing;
    await flushPendingSync();

    expect(order).toEqual([
      `folder:${first.id}`,
      `folder:${second.id}`,
      `doc:${second.id}`,
    ]);
  });

  it("폴더 큐를 먼저 비우는 동안 끄면 프레젠테이션을 보내지 않는다", async () => {
    __resetFolderSyncForTests();
    const newFolder: Folder = {
      id: "f00000000000000000001",
      userId: USER,
      parentId: null,
      name: "새 폴더",
      trashedAt: null,
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
    };
    let finishFolder: (saved: Folder) => void = () => undefined;
    const pushFolder = vi.fn(
      () =>
        new Promise<Folder>((resolve) => {
          finishFolder = resolve;
        }),
    );
    __setFolderPusherForTests(pushFolder);
    setFolderSyncEnabled(true);

    scheduleFolderPush(newFolder);
    scheduleDocumentPush({ ...doc("a"), folderId: newFolder.id });
    const flushing = flushPendingSync();
    await vi.waitFor(() => expect(pushFolder).toHaveBeenCalledTimes(1));

    setSyncEnabled(false);
    finishFolder(newFolder);
    await flushing;

    expect(push).not.toHaveBeenCalled();
    __resetFolderSyncForTests();
  });

  describe("세트가 담긴 폴더를 기다리기", () => {
    let pushFolder: ReturnType<typeof vi.fn<(f: Folder) => Promise<Folder>>>;

    function inFolder(id: string, folderId: string | null = FOLDER) {
      return { ...doc(id), folderId };
    }

    beforeEach(() => {
      __resetFolderSyncForTests();
      pushFolder = vi.fn(async (f: Folder) => f);
      __setFolderPusherForTests(pushFolder);
      __setFolderBackoffRandomForTests(() => 1);
      setFolderSyncEnabled(true);
      setSyncEnabled(true);
    });

    afterEach(() => {
      __resetFolderSyncForTests();
      vi.useRealTimers();
    });

    it("폴더가 백오프로 기다리는 동안 붙잡힌 세트는 폴더 재시도를 앞당기지 않고, 폴더가 오르면 곧바로 올린다", async () => {
      vi.useFakeTimers();
      pushFolder.mockRejectedValueOnce(
        new ServerRejectedError(503, API_ERRORS.serverBusy, 30_000),
      );
      scheduleFolderPush(newFolder());
      for (const id of ["a", "b", "c", "d"]) scheduleDocumentPush(inFolder(id));

      await vi.advanceTimersByTimeAsync(25_000);

      expect(pushFolder).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
      expect(hasPendingDocumentPush()).toBe(true);
      expect(getSyncSnapshot().status).toBe("offline");

      await vi.advanceTimersByTimeAsync(8_000);

      expect(pushFolder).toHaveBeenCalledTimes(2);
      expect(push.mock.calls.map(([sent]) => sent.id).sort()).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
      expect(Math.min(...push.mock.invocationCallOrder)).toBeGreaterThan(
        pushFolder.mock.invocationCallOrder[1],
      );
      expect(hasPendingDocumentPush()).toBe(false);
      expect(getSyncSnapshot().status).toBe("synced");
    });

    it("담긴 폴더가 영구 실패하면 붙잡힌 세트를 놓아 준다", async () => {
      vi.useFakeTimers();
      pushFolder
        .mockRejectedValueOnce(new ServerRejectedError(503, "과부하", 30_000))
        .mockRejectedValueOnce(new ServerRejectedError(400, "거절"));
      scheduleFolderPush(newFolder());
      scheduleDocumentPush(inFolder("a"));

      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
      expect(push).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(pushFolder).toHaveBeenCalledTimes(2);
      expect(push).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: "a", folderId: FOLDER }),
      );
      expect(hasPendingDocumentPush()).toBe(false);
    });

    it("루트 세트는 다른 폴더가 백오프로 기다려도 그 폴더를 보내지 않고 올린다", async () => {
      vi.useFakeTimers();
      pushFolder.mockRejectedValueOnce(
        new ServerRejectedError(503, "과부하", 30_000),
      );
      scheduleFolderPush(newFolder());
      await vi.advanceTimersByTimeAsync(2000);
      expect(pushFolder).toHaveBeenCalledTimes(1);

      scheduleDocumentPush(inFolder("a", null));
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);

      expect(push).toHaveBeenCalledTimes(1);
      expect(pushFolder).toHaveBeenCalledTimes(1);
    });

    it("세트는 자기 폴더가 아닌 폴더의 push가 끝나기를 기다리지 않는다", async () => {
      pushFolder.mockImplementation(() => new Promise<Folder>(() => {}));
      scheduleFolderPush(newFolder());
      void flushFolderSync();
      await vi.waitFor(() => expect(pushFolder).toHaveBeenCalledTimes(1));

      scheduleDocumentPush(inFolder("a", null));
      scheduleDocumentPush(inFolder("b", "f00000000000000000002"));
      void flushPendingSync();

      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(2));
    });

    it("flushPendingSync는 기다리는 세트가 없어도 대기 중인 폴더를 보낸다", async () => {
      scheduleFolderPush(newFolder());

      await flushPendingSync();

      expect(pushFolder).toHaveBeenCalledTimes(1);
    });

    it("부팅이 바로 올리는 폴더에 든 세트는 그 폴더가 오른 뒤에 올린다", async () => {
      const order: string[] = [];
      let release: () => void = () => undefined;
      pushFolder.mockImplementationOnce(
        (f) =>
          new Promise<Folder>((resolve) => {
            release = () => {
              order.push(`folder:${f.id}`);
              resolve(f);
            };
          }),
      );
      push.mockImplementation(async (document) => {
        order.push(`doc:${document.id}`);
        return true;
      });

      const booting = pushFolderNow(newFolder());
      await vi.waitFor(() => expect(pushFolder).toHaveBeenCalledTimes(1));
      scheduleDocumentPush(inFolder("a"));
      const flushing = flushPendingSync();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(push).not.toHaveBeenCalled();

      release();
      await Promise.all([booting, flushing]);

      expect(order).toEqual([`folder:${FOLDER}`, "doc:a"]);
    });

    it("부팅이 바로 올리던 폴더가 일시 장애로 실패하면, 그 폴더를 기다리던 세트는 폴더가 다시 오른 뒤에 올린다", async () => {
      const order: string[] = [];
      let failBoot: (err: unknown) => void = () => undefined;
      pushFolder.mockImplementation(async (f) => {
        order.push(`folder:${f.id}`);
        return f;
      });
      pushFolder.mockImplementationOnce(
        (f) =>
          new Promise<Folder>((_, reject) => {
            failBoot = (err) => {
              order.push(`folder-try:${f.id}`);
              reject(err);
            };
          }),
      );
      push.mockImplementation(async (document) => {
        order.push(`doc:${document.id}`);
        return true;
      });

      const booting = pushFolderNow(newFolder()).catch(() => {
        scheduleFolderPush(newFolder());
      });
      await vi.waitFor(() => expect(pushFolder).toHaveBeenCalledTimes(1));
      scheduleDocumentPush(inFolder("a"));
      const flushing = flushPendingSync();
      await new Promise((resolve) => setTimeout(resolve, 0));

      failBoot(new ServerRejectedError(503, API_ERRORS.serverBusy));
      await Promise.all([booting, flushing]);

      expect(order).toEqual([`folder-try:${FOLDER}`]);
      expect(hasPendingDocumentPush()).toBe(true);

      await flushPendingSync();

      expect(order).toEqual([
        `folder-try:${FOLDER}`,
        `folder:${FOLDER}`,
        "doc:a",
      ]);
      expect(hasPendingDocumentPush()).toBe(false);
    });

    it("폴더 재시도를 기다리며 붙잡힌 세트는 부팅이 같은 폴더를 바로 올리다 실패해도 놓이지 않는다", async () => {
      vi.useFakeTimers();
      pushFolder.mockRejectedValueOnce(
        new ServerRejectedError(503, API_ERRORS.serverBusy, 30_000),
      );
      scheduleFolderPush(newFolder());
      scheduleDocumentPush(inFolder("a"));
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
      expect(pushFolder).toHaveBeenCalledTimes(1);
      expect(hasPendingDocumentPush()).toBe(true);

      let failBoot: (err: unknown) => void = () => undefined;
      pushFolder.mockImplementationOnce(
        () =>
          new Promise<Folder>((_, reject) => {
            failBoot = reject;
          }),
      );
      const booting = pushFolderNow(newFolder()).catch(() => {
        scheduleFolderPush(newFolder());
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(pushFolder).toHaveBeenCalledTimes(2);

      failBoot(new ServerRejectedError(503, API_ERRORS.serverBusy, 30_000));
      await booting;
      await vi.advanceTimersByTimeAsync(0);

      expect(push).not.toHaveBeenCalled();
      expect(hasPendingDocumentPush()).toBe(true);

      await vi.advanceTimersByTimeAsync(2000);

      expect(pushFolder).toHaveBeenCalledTimes(2);
      expect(push).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(pushFolder).toHaveBeenCalledTimes(3);
      expect(push).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: "a", folderId: FOLDER }),
      );
      expect(push.mock.invocationCallOrder[0]).toBeGreaterThan(
        pushFolder.mock.invocationCallOrder[2],
      );
    });

    it("폴더가 오르기를 기다리는 동안 고친 세트도 폴더가 오르면 마지막 판을 올린다", async () => {
      vi.useFakeTimers();
      pushFolder.mockRejectedValueOnce(
        new ServerRejectedError(503, "과부하", 30_000),
      );
      scheduleFolderPush(newFolder());
      scheduleDocumentPush({ ...inFolder("a"), title: "첫 판" });
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);

      scheduleDocumentPush({ ...inFolder("a"), title: "고친 판" });
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS * 2);
      expect(push).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(push.mock.calls.map(([sent]) => sent.title)).toEqual(["고친 판"]);
    });

    it("붙잡힌 세트를 루트로 옮기면 폴더를 기다리지 않고 디바운스 뒤에 올린다", async () => {
      vi.useFakeTimers();
      pushFolder.mockRejectedValueOnce(
        new ServerRejectedError(503, "과부하", 30_000),
      );
      scheduleFolderPush(newFolder());
      scheduleDocumentPush(inFolder("a"));
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);

      scheduleDocumentPush(inFolder("a", null));
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);

      expect(push).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: "a", folderId: null }),
      );
      expect(pushFolder).toHaveBeenCalledTimes(1);
    });
  });

  describe("영구 실패한 세트", () => {
    it("영구 실패한 요청을 보내는 동안 고친 판은 버리지 않고 올린다", async () => {
      push.mockImplementationOnce(async () => {
        scheduleDocumentPush(doc("a", "고친 판"));
        throw new ServerRejectedError(400, "거절");
      });

      scheduleDocumentPush(doc("a", "처음 판"));
      await flushPendingSync();

      expect(hasPendingDocumentPush()).toBe(true);
      expect(getSyncSnapshot().status).toBe("error");

      await flushPendingSync();

      expect(push.mock.calls.map(([sent]) => sent.title)).toEqual([
        "처음 판",
        "고친 판",
      ]);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });

      retryPendingSyncNow("manual");
      await flushPendingSync();
      expect(push).toHaveBeenCalledTimes(2);
    });
  });

  describe("타이머", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("입력이 멈추면 디바운스 뒤에 올린다", async () => {
      scheduleDocumentPush(doc("a"));

      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS - 1);
      expect(push).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(push).toHaveBeenCalledTimes(1);
    });

    it("쉬지 않고 30초 입력해도 최대 대기 시간마다 올린다", async () => {
      for (let elapsed = 0; elapsed < 30_000; elapsed += 500) {
        scheduleDocumentPush(doc("a", String(elapsed)));
        await vi.advanceTimersByTimeAsync(500);
      }

      expect(push.mock.calls.length).toBeGreaterThanOrEqual(
        Math.floor(30_000 / SYNC_MAX_WAIT_MS),
      );
      expect(push.mock.calls[0][0].title).toBe(String(SYNC_MAX_WAIT_MS - 500));
    });

    it("올린 뒤 다시 고치면 최대 대기 시간을 새로 센다", async () => {
      scheduleDocumentPush(doc("a"));
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
      expect(push).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(SYNC_MAX_WAIT_MS);
      scheduleDocumentPush(doc("a", "2"));
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS - 1);
      expect(push).toHaveBeenCalledTimes(1);
    });
  });

  it("서로 다른 문서는 동시에 올린다", async () => {
    let active = 0;
    let peak = 0;
    push.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return true;
    });

    for (const id of ["a", "b", "c", "d", "e"]) scheduleDocumentPush(doc(id));
    await flushPendingSync();

    expect(push).toHaveBeenCalledTimes(5);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("오프라인으로 되돌릴 때 그 사이 새로 예약한 판을 덮어쓰지 않는다", async () => {
    let release: () => void = () => {};
    push.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          release = () => reject(new OfflineError());
        }),
    );

    scheduleDocumentPush(doc("a", "옛 판"));
    const flushing = flushPendingSync();
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    scheduleDocumentPush(doc("a", "새 판"));
    release();
    await flushing;

    await flushPendingSync();
    expect(push.mock.calls.at(-1)?.[0].title).toBe("새 판");
  });

  it("Head-of-Line Blocking 방지: 느린 문서 A가 전송 중이어도 다른 문서 B는 먼저 시작하고 끝난다", async () => {
    let finishA: () => void = () => {};
    const order: string[] = [];

    push.mockImplementation(async (d) => {
      if (d.id === "a") {
        await new Promise<void>((resolve) => {
          finishA = resolve;
        });
      }
      order.push(d.id);
      return true;
    });

    vi.useFakeTimers();

    scheduleDocumentPush(doc("a"));
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));

    scheduleDocumentPush(doc("b"));
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);

    expect(order).toEqual(["b"]);

    finishA();
    await vi.waitFor(() => expect(order).toEqual(["b", "a"]));
    vi.useRealTimers();
  });

  it("동일 문서 직렬화: 문서 A가 전송 중일 때 들어온 새 수정은 첫 전송이 끝난 뒤 나간다", async () => {
    let finishFirst: () => void = () => {};
    let firstInFlight = false;
    let secondStartedWhileFirstInFlight = false;

    push.mockImplementation(async (d) => {
      if (d.title === "1차") {
        firstInFlight = true;
        await new Promise<void>((resolve) => {
          finishFirst = resolve;
        });
        firstInFlight = false;
      } else if (d.title === "2차") {
        if (firstInFlight) secondStartedWhileFirstInFlight = true;
      }
      return true;
    });

    scheduleDocumentPush(doc("a", "1차"));
    const flushing = flushPendingSync();
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

    scheduleDocumentPush(doc("a", "2차"));
    finishFirst();
    await flushing;
    await flushPendingSync();

    expect(secondStartedWhileFirstInFlight).toBe(false);
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[1][0].title).toBe("2차");
  });

  it("503 응답 2회 후 200 성공 시 사용자는 error(동기화 실패)를 보지 않고 복구된다", async () => {
    push
      .mockRejectedValueOnce(
        new ServerRejectedError(503, "Service Unavailable"),
      )
      .mockRejectedValueOnce(
        new ServerRejectedError(503, "Service Unavailable"),
      )
      .mockResolvedValueOnce(true);

    __setBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleDocumentPush(doc("a"));
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledTimes(1);
    expect(getSyncSnapshot().status).toBe("offline");

    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().status).toBe("offline");

    await vi.advanceTimersByTimeAsync(4000);
    expect(push).toHaveBeenCalledTimes(3);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  it("서버가 Retry-After를 주면 백오프 계산 대신 헤더 값을 기다린다", async () => {
    push
      .mockRejectedValueOnce(new ServerRejectedError(503, "과부하", 15_000))
      .mockResolvedValueOnce(true);

    vi.useFakeTimers();

    scheduleDocumentPush(doc("a"));
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledTimes(1);
    expect(getSyncSnapshot().status).toBe("offline");

    await vi.advanceTimersByTimeAsync(14_000);
    expect(push).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(push).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  it("영구 실패(400)는 재시도하지 않고 error 상태와 실패 문서 정보를 남긴다", async () => {
    push.mockRejectedValue(new ServerRejectedError(400, "잘못된 문서 구조"));

    scheduleDocumentPush(doc("a", "불량 세트"));
    await flushPendingSync();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: "a",
      title: "불량 세트",
      kind: "presentation",
      status: 400,
    });

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(push).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  describe("401이면 항목을 버리지 않고 백오프 뒤 다시 보내고, 한도를 넘으면 실패로 남긴다", () => {
    beforeEach(() => {
      __setBackoffRandomForTests(() => 1);
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("401 뒤 세션이 살아 있으면 백오프 뒤 다시 보내 동기화됨으로 끝난다", async () => {
      push
        .mockRejectedValueOnce(new SessionExpiredError())
        .mockResolvedValue(true);

      scheduleDocumentPush(doc("a"));
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
      expect(push).toHaveBeenCalledTimes(1);
      expect(getSyncSnapshot().status).toBe("error");

      await vi.advanceTimersByTimeAsync(2000);

      expect(push).toHaveBeenCalledTimes(2);
      expect(push.mock.calls[1][0].id).toBe("a");
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
    });

    it("401이 이어지면 재시도 한도 뒤 실패로 남기고, '다시 시도'가 다시 보낸다", async () => {
      push.mockRejectedValue(new SessionExpiredError());

      scheduleDocumentPush(doc("a", "만료된 세트"));
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
      for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
        await vi.advanceTimersByTimeAsync(60_000);
      }

      expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);
      expect(getSyncSnapshot()).toMatchObject({
        status: "error",
        lastFailure: { id: "a", title: "만료된 세트", kind: "presentation" },
      });

      await vi.advanceTimersByTimeAsync(60_000);
      expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);

      push.mockResolvedValue(true);
      retryPendingSyncNow("manual");
      await flushPendingSync();

      expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 2);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
    });

    it("포커스(wake)는 401로 기다리는 항목을 앞당기지 않는다", async () => {
      push
        .mockRejectedValueOnce(new SessionExpiredError())
        .mockResolvedValue(true);

      scheduleDocumentPush(doc("a"));
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
      retryPendingSyncNow("wake");
      await vi.advanceTimersByTimeAsync(1999);

      expect(push).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(push).toHaveBeenCalledTimes(2);
    });
  });

  it("동시에 여러 문서가 실패해도 각 문서의 백오프 attempt는 독립적으로 계산된다", async () => {
    push.mockRejectedValueOnce(
      new ServerRejectedError(503, "Service Unavailable"),
    );
    push.mockRejectedValueOnce(
      new ServerRejectedError(503, "Service Unavailable"),
    );
    push.mockResolvedValue(true);

    __setBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleDocumentPush(doc("a"));
    scheduleDocumentPush(doc("b"));
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(4);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  it("오프라인 편집 시 활성 백오프 지연이 디바운스 기본값(3초)으로 단축되지 않고 유지된다", async () => {
    push
      .mockRejectedValueOnce(new ServerRejectedError(503, "과부하", 10_000))
      .mockResolvedValue(true);

    vi.useFakeTimers();

    scheduleDocumentPush(doc("a", "1차"));
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    scheduleDocumentPush(doc("a", "2차"));

    await vi.advanceTimersByTimeAsync(3000);
    expect(push).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[1][0].title).toBe("2차");

    vi.useRealTimers();
  });

  it("재시도 한도를 넘긴 일시 장애(503)는 동기화 실패로 보이되 버리지 않고 SLOW_RETRY_MS 뒤에 다시 보낸다", async () => {
    push.mockRejectedValue(new ServerRejectedError(503, "지속 과부하"));
    __setBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleDocumentPush(doc("a"));
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(push).toHaveBeenCalledTimes(11);
    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: "a",
      kind: "presentation",
      status: 503,
    });
    expect(hasPendingDocumentPush()).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    retryPendingSyncNow("wake");
    await vi.advanceTimersByTimeAsync(0);
    expect(push).toHaveBeenCalledTimes(11);

    push.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS);

    expect(push).toHaveBeenCalledTimes(12);
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });

    vi.useRealTimers();
  });

  it("재시도 한도를 넘긴 서버 오류(500)는 천천히 다시 보내지 않고 영구 실패로 남긴다", async () => {
    push.mockRejectedValue(new ServerRejectedError(500, "서버 오류"));
    __setBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleDocumentPush(doc("a"));
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);
    expect(hasPendingDocumentPush()).toBe(false);
    expect(isDocumentQueued("a")).toBe(true);
    expect(getSyncSnapshot()).toMatchObject({
      status: "error",
      lastFailure: { id: "a", kind: "presentation", status: 500 },
    });

    await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS * 2);
    expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);

    push.mockResolvedValue(true);
    retryPendingSyncNow("manual");
    await vi.advanceTimersByTimeAsync(0);

    expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 2);
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });

    vi.useRealTimers();
  });

  it("서버가 몇 분 동안 503을 주다 회복하면 다시 시도를 누르지 않아도 미뤄 둔 세트를 올린다", async () => {
    vi.useFakeTimers();
    __setBackoffRandomForTests(() => 0);
    const recoversAt = Date.now() + 5 * 60_000;
    push.mockImplementation(async () => {
      if (Date.now() < recoversAt) {
        throw new ServerRejectedError(503, "", 2000);
      }
      return true;
    });

    scheduleDocumentPush(doc("a"));
    await vi.advanceTimersByTimeAsync(12 * 60_000);

    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
    expect(hasPendingDocumentPush()).toBe(false);

    vi.useRealTimers();
  });

  it("Retry-After가 늘 2초여도 시도할수록 간격을 늘려 90초 동안 7번을 넘게 보내지 않는다", async () => {
    vi.useFakeTimers();
    __setBackoffRandomForTests(() => 1);
    push.mockRejectedValue(new ServerRejectedError(503, "과부하", 2000));

    scheduleDocumentPush(doc("a"));
    await vi.advanceTimersByTimeAsync(90_000);

    expect(getSyncSnapshot().status).toBe("offline");
    expect(push.mock.calls.length).toBeLessThanOrEqual(7);

    vi.useRealTimers();
  });

  it("재시도 한도를 넘겨 천천히 다시 보내던 세트는 다시 시도하면 곧바로 보내고 실패 표시를 지운다", async () => {
    vi.useFakeTimers();
    __setBackoffRandomForTests(() => 0);
    push.mockRejectedValue(new ServerRejectedError(503, "지속 과부하"));
    scheduleDocumentPush(doc("a"));
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);
    expect(getSyncSnapshot().status).toBe("error");

    let release: () => void = () => undefined;
    push.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    retryPendingSyncNow("manual");
    await vi.advanceTimersByTimeAsync(0);

    expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 2);
    expect(getSyncSnapshot()).toMatchObject({
      status: "syncing",
      lastFailure: null,
    });

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  it("오프라인(OfflineError)은 10회를 초과해도 재시도를 포기하지 않고 큐에 유지된다", async () => {
    push.mockRejectedValue(new OfflineError());
    __setBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleDocumentPush(doc("a"));
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(push.mock.calls.length).toBeGreaterThanOrEqual(15);
    expect(getSyncSnapshot().status).toBe("offline");

    push.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });
});

describe("서버가 받을 수 있게 다듬어 올리기", () => {
  const DOC_ID = "100000000000000000001";
  let api: FakeApi;
  let respondToPatch: () => { status?: number; body: unknown };

  function patchCalls(): FakeApi["calls"] {
    return api.calls.filter((call) => call.method === "PATCH");
  }

  beforeEach(() => {
    __resetSyncSchedulerForTests();
    __resetServerDecksForTests();
    resetSyncStatus();
    respondToPatch = () => ({ body: { ok: true } });
    api = installFakeApi({
      "PATCH /api/presentations/*": () => respondToPatch(),
    });
    __setPusherForTests(null);
    setSyncEnabled(true);
  });

  afterEach(() => {
    api.restore();
    __resetSyncSchedulerForTests();
  });

  it("덱이 빠진 항목이 있는 문서는 보내지 않고 실패와 이유를 남기며, 고친 문서를 올리면 지운다", async () => {
    const broken: Presentation = {
      ...doc(DOC_ID, "주일 1부"),
      items: [
        {
          id: "300000000000000000001",
          presentationId: DOC_ID,
          deckId: "c00000000000000000001",
          order: 0,
        },
      ],
    };

    scheduleDocumentPush(broken);
    await flushPendingSync();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: DOC_ID,
      title: "주일 1부",
      reason: ERROR_COPY.documentInvalid,
    });
    expect(patchCalls()).toHaveLength(0);

    scheduleDocumentPush({ ...broken, items: [] });
    await flushPendingSync();

    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
    expect(patchCalls()).toHaveLength(1);
  });

  it("페이지가 숨겨진 뒤 비우는 PATCH는 폴더 push를 기다리지 않고 keepalive로 보낸다", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    __resetFolderSyncForTests();
    __setFolderPusherForTests(() => new Promise<Folder>(() => {}));
    setFolderSyncEnabled(true);
    try {
      scheduleFolderPush(newFolder());
      scheduleDocumentPush(doc(DOC_ID));

      void flushFolderSync();
      void flushPendingSync();
      await vi.waitFor(() => expect(patchCalls()).toHaveLength(1));

      const patchInit = vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([, init]) => init?.method === "PATCH")?.[1];
      expect(patchInit?.keepalive).toBe(true);
    } finally {
      visibility.mockRestore();
      __resetFolderSyncForTests();
    }
  });

  it("101자 제목은 100자로 줄여 올리고 동기화됨으로 끝난다", async () => {
    scheduleDocumentPush(doc(DOC_ID, "가".repeat(101)));
    await flushPendingSync();

    expect(patchCalls()).toHaveLength(1);
    expect(patchCalls()[0].body).toMatchObject({ title: "가".repeat(100) });
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("서버가 너무 크다고 거절하면(413) 서버가 준 문장을 이유로 남긴다", async () => {
    const sentence = API_ERRORS.presentation.songTooLarge("긴 곡");
    respondToPatch = () => ({ status: 413, body: { error: sentence } });

    scheduleDocumentPush(doc(DOC_ID));
    await flushPendingSync();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: DOC_ID,
      status: 413,
      reason: sentence,
    });
  });
});
