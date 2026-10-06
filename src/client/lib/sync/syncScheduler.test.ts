import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Presentation } from "#shared";
import {
  scheduleDocumentPush,
  cancelDocumentPush,
  flushPendingSync,
  setSyncEnabled,
  SYNC_DEBOUNCE_MS,
  SYNC_MAX_WAIT_MS,
  __resetSyncSchedulerForTests,
  __setPusherForTests,
  __setBackoffRandomForTests,
} from "./syncScheduler";
import { getSyncSnapshot, resetSyncStatus } from "./syncStatus";
import {
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
  TimeoutError,
} from "../api/request";
import { installFakeApi } from "../../test/fakeApi";
import {
  scheduleFolderPush,
  flushFolderSync,
  setFolderSyncEnabled,
  __resetFolderSyncForTests,
  __setFolderPusherForTests,
} from "./folderSync";

const USER = "00000000x000000000001";

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

  it("세트 동기화가 실패한 뒤 폴더 동기화가 성공해도 동기화 실패로 남는다", async () => {
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

  it("다른 세트가 성공해도 실패한 세트가 다시 올라가기 전까지 실패로 남는다", async () => {
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
    expect(getSyncSnapshot()).toEqual({ status: "synced", lastFailure: null });
  });

  it("실패한 세트를 영구 삭제하면 실패 표시를 지운다", async () => {
    push.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));

    scheduleDocumentPush(doc("a"));
    await flushPendingSync();
    expect(getSyncSnapshot().status).toBe("error");

    cancelDocumentPush("a");
    expect(getSyncSnapshot()).toEqual({ status: "synced", lastFailure: null });
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

  it("401 세션 만료는 재시도하지 않는다", async () => {
    push.mockRejectedValue(new SessionExpiredError());

    scheduleDocumentPush(doc("a"));
    await flushPendingSync();

    expect(getSyncSnapshot().status).toBe("error");

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(push).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
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

  it("재시도 한도(MAX_RETRY_ATTEMPTS)를 초과하면 재시도를 중단하고 error 상태가 된다", async () => {
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

    await vi.advanceTimersByTimeAsync(60_000);
    expect(push).toHaveBeenCalledTimes(11);

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
