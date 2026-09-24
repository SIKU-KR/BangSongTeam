import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createId, type Presentation } from "@repo/shared";
import {
  getOfflineDB,
  closeOfflineDB,
  OFFLINE_DB_NAME,
  type WorshipOfflineDB,
} from "./db";
import {
  savePresentation,
  loadAllPresentations,
  deletePresentation,
  clearAllPresentations,
} from "./presentationRepository";

function makePresentation(overrides: Partial<Presentation> = {}): Presentation {
  const now = new Date().toISOString();
  return {
    id: createId(),
    userId: "00000000x000000000001",
    title: "테스트 프레젠테이션",
    serviceDate: "2026-09-27",
    items: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function resetDatabase(): Promise<void> {
  closeOfflineDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

/** 스키마를 위반하는 원시 레코드를 스토어에 직접 심는다 */
async function seedRawRecord(record: unknown): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction("presentations", "readwrite");
  await tx.store.put(record as WorshipOfflineDB["presentations"]["value"]);
  await tx.done;
}

describe("presentationRepository", () => {
  beforeEach(resetDatabase);
  afterEach(closeOfflineDB);

  it("저장한 문서를 그대로 다시 읽는다", async () => {
    const presentation = makePresentation({ title: "주일 1부" });

    await savePresentation(presentation);
    const { valid, corrupted } = await loadAllPresentations();

    expect(corrupted).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toEqual(presentation);
  });

  it("같은 id로 저장하면 문서를 교체한다 (문서 단위 put)", async () => {
    const presentation = makePresentation({ title: "원본" });
    await savePresentation(presentation);
    await savePresentation({ ...presentation, title: "수정본" });

    const { valid } = await loadAllPresentations();

    expect(valid).toHaveLength(1);
    expect(valid[0].title).toBe("수정본");
  });

  it("문서를 삭제할 수 있다", async () => {
    const presentation = makePresentation();
    await savePresentation(presentation);

    await deletePresentation(presentation.id);
    const { valid } = await loadAllPresentations();

    expect(valid).toHaveLength(0);
  });

  it("손상된 문서는 결과에서 분리하되 저장소에서 지우지 않는다", async () => {
    const healthy = makePresentation({ title: "정상" });
    await savePresentation(healthy);
    await seedRawRecord({ id: "broken-1", title: 42 });

    const first = await loadAllPresentations();

    expect(first.valid.map((p) => p.title)).toEqual(["정상"]);
    expect(first.corrupted).toHaveLength(1);
    expect(first.corrupted[0].id).toBe("broken-1");

    // 재조회해도 손상 레코드가 여전히 남아 있어야 한다 (복구 가능성 보존)
    const second = await loadAllPresentations();
    expect(second.corrupted).toHaveLength(1);
    expect(second.valid).toHaveLength(1);
  });

  it("빈 저장소에서는 에러 없이 빈 결과를 반환한다", async () => {
    const { valid, corrupted } = await loadAllPresentations();

    expect(valid).toEqual([]);
    expect(corrupted).toEqual([]);
  });

  it("clearAllPresentations는 모든 문서를 비운다", async () => {
    await savePresentation(makePresentation());
    await savePresentation(makePresentation());

    await clearAllPresentations();
    const { valid } = await loadAllPresentations();

    expect(valid).toHaveLength(0);
  });
});
