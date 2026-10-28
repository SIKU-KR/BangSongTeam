import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { toast } from "sonner";
import type { Presentation } from "#shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import { SEED_PRESENTATIONS } from "../../test/presentationFixture";
import {
  __loadDocumentsForTests,
  getPresentationById,
  listPresentations,
  resetPresentationStore,
} from "../../features/presentation/presentationStore";
import { isSyncedWithServer } from "../../features/presentation/presentationDocument";
import {
  __resetSyncSchedulerForTests,
  __setPusherForTests,
  cancelDocumentPush,
  flushPendingSync,
  scheduleDocumentPush,
  setSyncEnabled,
} from "./syncScheduler";
import {
  beginPermanentDelete,
  ownPresentationListener,
} from "./ownPresentationListener";
import { PRESENTATION_COPY } from "#copy/presentation";
import { COMMON_COPY } from "#copy/common";

const MISSING = "x00000000000000000000";

describe("ownPresentationListener", () => {
  const push = vi.fn(async (document: Presentation) => document.id);

  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __resetSyncSchedulerForTests();
    push.mockClear();
    __setPusherForTests(push);
    setSyncEnabled(true);
    __loadDocumentsForTests([SEED_PRESENTATIONS[0]]);
  });

  afterEach(() => {
    __resetSyncSchedulerForTests();
    resetPresentationStore();
  });

  it("스토어에 지금 있는 판을 돌려주고, 없는 세트는 없다고 답한다", () => {
    const [seed] = SEED_PRESENTATIONS;

    expect(ownPresentationListener.current(seed.id)).toBe(
      getPresentationById(seed.id),
    );
    expect(ownPresentationListener.current(MISSING)).toBeUndefined();
  });

  it("다시 넣으면 지금 판을 큐에 넣고, 없는 세트는 넣지 않는다", async () => {
    const [seed] = SEED_PRESENTATIONS;

    ownPresentationListener.requeue(seed.id);
    ownPresentationListener.requeue(MISSING);
    await flushPendingSync();

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toBe(getPresentationById(seed.id));
  });
});

describe("ownPresentationListener — 올리기 결과", () => {
  const startPath = window.location.pathname;
  const [FIRST, SECOND, THIRD] = SEED_PRESENTATIONS;
  const T1 = "2026-10-01T00:00:00.000Z";
  const T2 = "2026-10-01T00:05:00.000Z";
  const S = "2026-10-01T00:07:00.000Z";
  const OTHER_USER = "999999999999999999999";
  const push = vi.fn(async (document: Presentation) => document.id);
  let info: MockInstance<typeof toast.info>;

  function serverCopy(
    doc: Presentation,
    changes: Partial<Presentation> = {},
  ): Presentation {
    return {
      ...structuredClone(doc),
      title: "다른 기기에서 고친 제목",
      updatedAt: S,
      ...changes,
    };
  }

  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __resetSyncSchedulerForTests();
    push.mockClear();
    __setPusherForTests(push);
    setSyncEnabled(true);
    info = vi.spyOn(toast, "info");
    __loadDocumentsForTests([
      { ...FIRST, baseUpdatedAt: T1, updatedAt: T2 },
      { ...SECOND, baseUpdatedAt: T1, updatedAt: T1 },
      { ...THIRD, baseUpdatedAt: T1, updatedAt: T2 },
    ]);
  });

  afterEach(() => {
    info.mockRestore();
    __resetSyncSchedulerForTests();
    resetPresentationStore();
    window.history.pushState({}, "", startPath);
  });

  it("서버가 받은 판을 확정하고, 다시 보낼 판의 기준 판을 옮긴다", () => {
    ownPresentationListener.saved(getPresentationById(FIRST.id)!, S);
    ownPresentationListener.rebase(THIRD.id, S);

    expect(isSyncedWithServer(getPresentationById(FIRST.id)!)).toBe(true);
    expect(getPresentationById(THIRD.id)?.baseUpdatedAt).toBe(S);
  });

  it("송출 중에는 서버 판 받기·엇갈림·영구 삭제를 하지 않고 큐에 다시 넣어, 송출을 마치면 다시 올린다", async () => {
    const before = listPresentations();
    window.history.pushState({}, "", `/present/${FIRST.id}/fullscreen`);

    ownPresentationListener.adopt(serverCopy(SECOND));
    ownPresentationListener.conflict(serverCopy(FIRST));
    ownPresentationListener.gone(THIRD.id);
    await flushPendingSync();

    expect(listPresentations()).toBe(before);
    expect(push).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();

    window.history.pushState({}, "", "/presentations");
    await flushPendingSync();

    expect(push.mock.calls.map(([doc]) => doc.id).sort()).toEqual(
      [FIRST.id, SECOND.id, THIRD.id].sort(),
    );
  });

  it("이 탭에 없는 세트나 다른 계정의 판에 대한 결과는 버린다", () => {
    const before = listPresentations();

    ownPresentationListener.adopt(serverCopy(FIRST, { id: MISSING }));
    ownPresentationListener.conflict(serverCopy(FIRST, { userId: OTHER_USER }));
    ownPresentationListener.gone(MISSING);
    signInAsTestUser(OTHER_USER);
    ownPresentationListener.saved(getPresentationById(FIRST.id)!, S);
    ownPresentationListener.gone(THIRD.id);

    expect(listPresentations()).toBe(before);
    expect(info).not.toHaveBeenCalled();
  });

  it("보내는 중에 취소한 push의 결과는 버린다", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    __setPusherForTests(async (doc: Presentation) => {
      started();
      await gate;
      ownPresentationListener.saved(doc, S);
    });
    scheduleDocumentPush(getPresentationById(FIRST.id)!);
    const pushing = flushPendingSync();
    await sending;

    cancelDocumentPush(FIRST.id);
    release();
    await pushing;

    expect(getPresentationById(FIRST.id)).toMatchObject({
      baseUpdatedAt: T1,
      updatedAt: T2,
    });
  });

  it("엇갈린 세트는 이 기기의 편집을 사본으로 남기고 사본 이름을 담은 알림 하나로 알린다", () => {
    ownPresentationListener.conflict(serverCopy(FIRST));
    ownPresentationListener.conflict(serverCopy(THIRD));

    const copies = listPresentations().filter((doc) =>
      doc.title.endsWith(COMMON_COPY.copySuffix),
    );
    expect(copies.map((doc) => doc.title).sort()).toEqual(
      [
        `${FIRST.title}${COMMON_COPY.copySuffix}`,
        `${THIRD.title}${COMMON_COPY.copySuffix}`,
      ].sort(),
    );
    expect(getPresentationById(FIRST.id)?.title).toBe(
      "다른 기기에서 고친 제목",
    );
    expect(info.mock.calls).toEqual([
      [
        PRESENTATION_COPY.conflictSavedAsCopy(
          `${FIRST.title}${COMMON_COPY.copySuffix}`,
        ),
        { id: "presentation-conflict" },
      ],
      [
        PRESENTATION_COPY.conflictSavedAsCopy(
          `${THIRD.title}${COMMON_COPY.copySuffix}`,
        ),
        { id: "presentation-conflict" },
      ],
    ]);
  });

  it("다른 곳에서 영구 삭제한 세트는 지우고, 올리지 않은 편집이 있으면 사본으로 남겼다고 알린다", () => {
    ownPresentationListener.gone(FIRST.id);
    ownPresentationListener.gone(SECOND.id);

    expect(getPresentationById(FIRST.id)).toBeUndefined();
    expect(getPresentationById(SECOND.id)).toBeUndefined();
    const copy = listPresentations().find(
      (doc) => doc.title === `${FIRST.title}${COMMON_COPY.copySuffix}`,
    );
    expect(copy?.baseUpdatedAt).toBeNull();
    expect(info.mock.calls).toEqual([
      [
        PRESENTATION_COPY.deletedSavedAsCopy(copy!.title),
        { id: "presentation-gone" },
      ],
      [PRESENTATION_COPY.deletedElsewhere, { id: "presentation-gone" }],
    ]);
  });

  it("영구 삭제하는 동안의 세트는 사본도 알림도 없이 서버 판을 받거나 지우고, 영구 삭제를 마치면 다시 알린다", () => {
    const end = beginPermanentDelete([FIRST.id, SECOND.id, THIRD.id]);
    const before = listPresentations().length;

    ownPresentationListener.conflict(serverCopy(FIRST));
    ownPresentationListener.gone(THIRD.id);

    expect(getPresentationById(FIRST.id)?.title).toBe(
      "다른 기기에서 고친 제목",
    );
    expect(getPresentationById(THIRD.id)).toBeUndefined();
    expect(listPresentations()).toHaveLength(before - 1);
    expect(info).not.toHaveBeenCalled();

    end();
    ownPresentationListener.gone(SECOND.id);

    expect(info).toHaveBeenCalledExactlyOnceWith(
      PRESENTATION_COPY.deletedElsewhere,
      { id: "presentation-gone" },
    );
  });
});
