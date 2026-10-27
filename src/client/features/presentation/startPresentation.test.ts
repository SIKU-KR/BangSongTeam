import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Presentation } from "#shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import * as capabilities from "../../lib/browser/capabilities";
import {
  __resetSyncSchedulerForTests,
  __setPusherForTests,
  flushPendingSync,
  isDocumentQueued,
  setSyncEnabled,
} from "../../lib/sync/syncScheduler";
import { SEED_PRESENTATIONS } from "../../test/presentationFixture";
import {
  __loadDocumentsForTests,
  renamePresentation,
  resetPresentationStore,
} from "./presentationStore";
import { startPresentation } from "./startPresentation";

describe("startPresentation", () => {
  const startPath = window.location.pathname;
  const SET = SEED_PRESENTATIONS[2];
  const documentPusher = vi.fn<(document: Presentation) => Promise<void>>();

  function navigateInPlace(to: string): void {
    window.history.pushState({}, "", to);
  }

  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    __resetSyncSchedulerForTests();
    documentPusher.mockReset();
    documentPusher.mockResolvedValue(undefined);
    __setPusherForTests(documentPusher);
    setSyncEnabled(true);
    vi.spyOn(capabilities, "canPresentReliably").mockReturnValue(true);
  });

  afterEach(() => {
    __resetSyncSchedulerForTests();
    vi.restoreAllMocks();
    window.history.pushState({}, "", startPath);
  });

  it("송출 화면으로 가기 전에 큐에 남은 세트 변경을 보낸다", async () => {
    renamePresentation(SET.id, "송출 직전에 고친 이름");

    const started = startPresentation(
      navigateInPlace,
      SET.id,
      "/presentations",
    );
    await flushPendingSync();

    expect(started).toBe(true);
    expect(window.location.pathname).toBe(`/present/${SET.id}/fullscreen`);
    expect(documentPusher).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: SET.id, title: "송출 직전에 고친 이름" }),
    );
  });

  it("송출을 그만두면 큐에 남은 세트 변경을 앞당겨 보내지 않는다", async () => {
    vi.mocked(capabilities.canPresentReliably).mockReturnValue(false);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renamePresentation(SET.id, "송출을 그만둔 뒤의 이름");

    const started = startPresentation(
      navigateInPlace,
      SET.id,
      "/presentations",
    );

    expect(started).toBe(false);
    expect(window.location.pathname).toBe(startPath);
    expect(isDocumentQueued(SET.id)).toBe(true);
    expect(documentPusher).not.toHaveBeenCalled();
  });
});
