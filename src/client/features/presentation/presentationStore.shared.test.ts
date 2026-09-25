import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PresentationDocumentSchema, type Presentation } from "#shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import { SEED_PRESENTATIONS, SEED_USER_ID } from "./mockPresentations";
import {
  __loadDocumentsForTests,
  canUndo,
  duplicatePresentation,
  getActivePresentation,
  getPresentationById,
  openPresentation,
  renamePresentation,
  replaceWithServerDocument,
  resetPresentationStore,
  updatePresentationTitle,
  updateSongStyle,
} from "./presentationStore";
import {
  __resetSyncSchedulerForTests,
  __setPusherForTests,
  flushPendingSync,
  setSyncEnabled,
} from "../../lib/sync/syncScheduler";

const OWNER = "0000000000000000owner";
const FOLDER = "f00000000000000000001";

function sharedCopyOf(source: Presentation): Presentation {
  return {
    ...source,
    id: "s0000000000000000000a",
    userId: OWNER,
    folderId: null,
    items: source.items.map((item) => ({
      ...item,
      presentationId: "s0000000000000000000a",
      deck: item.deck && {
        ...item.deck,
        userId: OWNER,
        presentationId: "s0000000000000000000a",
      },
    })),
    access: { ownerName: "인도자", memberId: SEED_USER_ID },
  };
}

describe("링크로 공유받은 세트 (보기 전용)", () => {
  const shared = sharedCopyOf(SEED_PRESENTATIONS[0]);

  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __resetSyncSchedulerForTests();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    replaceWithServerDocument(shared);
  });

  afterEach(() => {
    __resetSyncSchedulerForTests();
  });

  it("편집 함수를 불러도 바뀌지 않고 되돌리기 기록도 남지 않는다", () => {
    openPresentation(shared.id);
    updatePresentationTitle("몰래 수정");
    updateSongStyle(0, { fontSizeVw: 9 });
    renamePresentation(shared.id, "몰래 이름");

    expect(getActivePresentation()).toEqual(shared);
    expect(canUndo()).toBe(false);
  });

  it("서버로 올리지 않는다", async () => {
    const push = vi.fn(async () => true);
    __setPusherForTests(push);
    setSyncEnabled(true);

    openPresentation(shared.id);
    replaceWithServerDocument({ ...shared, title: "소유자가 바꿈" });
    await flushPendingSync();

    expect(getPresentationById(shared.id)?.title).toBe("소유자가 바꿈");
    expect(push).not.toHaveBeenCalled();
  });

  it("사본은 내 소유의 독립 세트로, 고른 폴더에 만든다", () => {
    const copy = duplicatePresentation(shared.id, FOLDER);

    expect(copy?.userId).toBe(SEED_USER_ID);
    expect(copy?.access).toBeUndefined();
    expect(copy?.folderId).toBe(FOLDER);
    expect(
      copy?.items.every((item) => item.deck?.userId === SEED_USER_ID),
    ).toBe(true);
    expect(PresentationDocumentSchema.safeParse(copy).success).toBe(true);

    openPresentation(copy!.id);
    updatePresentationTitle("내 사본");
    expect(getActivePresentation().title).toBe("내 사본");
  });

  it("위치를 주지 않으면 공유 세트의 사본은 내 드라이브 맨 위에 둔다", () => {
    expect(duplicatePresentation(shared.id)?.folderId).toBeNull();
  });
});
