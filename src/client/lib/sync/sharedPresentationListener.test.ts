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
import { PresentationDocumentSchema, type Presentation } from "#shared";
import { PRESENTATION_COPY } from "#copy/presentation";
import {
  seedPresentationsIntoStorage,
  signInAsTestUser,
} from "../../test/sessionFixture";
import {
  SEED_PRESENTATIONS,
  SEED_USER_ID,
} from "../../test/presentationFixture";
import {
  flushPendingWrites,
  getPresentationById,
  hydrateFromStorage,
  resetPresentationStore,
} from "../../features/presentation/presentationStore";
import { loadAllPresentations } from "../storage";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../storage/db";
import { sharedPresentationListener } from "./sharedPresentationListener";

const OWNER = "0000000000000000owner";
const MISSING = "x00000000000000000000";

async function resetDatabase(): Promise<void> {
  closeOfflineDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function storedIds(): Promise<string[]> {
  const { valid } = await loadAllPresentations();
  return valid.map((doc) => doc.id);
}

describe("sharedPresentationListener (공유받은 세트의 최신본·접근 상실)", () => {
  const shared: Presentation = {
    ...SEED_PRESENTATIONS[0],
    userId: OWNER,
    folderId: null,
    access: { ownerName: "인도자", memberId: SEED_USER_ID },
  };
  let info: MockInstance<typeof toast.info>;

  beforeEach(async () => {
    await resetDatabase();
    signInAsTestUser();
    resetPresentationStore();
    await seedPresentationsIntoStorage([shared]);
    await hydrateFromStorage();
    info = vi.spyOn(toast, "info");
  });

  afterEach(() => {
    info.mockRestore();
    resetPresentationStore();
    closeOfflineDB();
  });

  it("접근을 잃으면 사본을 메모리와 저장소에서 지우고 사용자에게 알린다", async () => {
    expect(getPresentationById(shared.id)).toBeDefined();
    expect(await storedIds()).toContain(shared.id);

    sharedPresentationListener.lost(shared.id);

    expect(getPresentationById(shared.id)).toBeUndefined();
    await vi.waitFor(async () =>
      expect(await storedIds()).not.toContain(shared.id),
    );
    expect(info).toHaveBeenCalledExactlyOnceWith(
      PRESENTATION_COPY.sharedRevoked,
    );
  });

  it("이 기기에 없는 세트의 접근 상실은 알리지 않는다", () => {
    sharedPresentationListener.lost(MISSING);

    expect(info).not.toHaveBeenCalled();
    expect(getPresentationById(shared.id)).toBeDefined();
  });

  it("최신본을 받으면 사본을 그 판으로 바꾸고 저장소에도 남긴다", async () => {
    sharedPresentationListener.replaced(
      PresentationDocumentSchema.parse({
        ...shared,
        title: "소유자가 바꾼 제목",
      }),
    );

    expect(getPresentationById(shared.id)?.title).toBe("소유자가 바꾼 제목");
    expect(getPresentationById(shared.id)?.access).toEqual(shared.access);
    await flushPendingWrites();
    const { valid } = await loadAllPresentations();
    expect(valid.find((doc) => doc.id === shared.id)?.title).toBe(
      "소유자가 바꾼 제목",
    );
    expect(info).not.toHaveBeenCalled();
  });
});
