import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Presentation } from "#shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import { SEED_PRESENTATIONS } from "../../test/presentationFixture";
import {
  __loadDocumentsForTests,
  getPresentationById,
  resetPresentationStore,
} from "../../features/presentation/presentationStore";
import {
  __resetSyncSchedulerForTests,
  __setPusherForTests,
  flushPendingSync,
  setSyncEnabled,
} from "./syncScheduler";
import { ownPresentationListener } from "./ownPresentationListener";

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
