import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createId, type Presentation } from "#shared";
import {
  getOfflineDB,
  closeOfflineDB,
  OFFLINE_DB_NAME,
  type WorshipOfflineDB,
} from "./db";
import {
  savePresentation,
  loadAllPresentations,
  loadPresentation,
  deletePresentation,
  saveSharedPresentation,
  deleteSharedPresentation,
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

    const second = await loadAllPresentations();
    expect(second.corrupted).toHaveLength(1);
    expect(second.valid).toHaveLength(1);
  });

  it("빈 저장소에서는 에러 없이 빈 결과를 반환한다", async () => {
    const { valid, corrupted } = await loadAllPresentations();

    expect(valid).toEqual([]);
    expect(corrupted).toEqual([]);
  });

  describe("한 건 읽기 (loadPresentation)", () => {
    it("저장본이 없으면 없다고 답한다", async () => {
      expect(await loadPresentation(createId())).toEqual({
        status: "missing",
      });
    });

    it("스키마를 통과하지 못한 저장본은 없다고 하지 않고 읽지 못했다고 답한다", async () => {
      await seedRawRecord({ id: "broken-1", title: 42 });

      expect(await loadPresentation("broken-1")).toEqual({
        status: "unreadable",
      });
    });

    it("저장한 문서를 그대로 읽는다", async () => {
      const presentation = makePresentation({ title: "주일 1부" });
      await savePresentation(presentation);

      expect(await loadPresentation(presentation.id)).toEqual({
        status: "ok",
        value: presentation,
      });
    });

    it("새 버전의 탭이 남긴 baseUpdatedAt은 떼고 읽는다", async () => {
      const presentation = makePresentation();
      await seedRawRecord({
        ...presentation,
        baseUpdatedAt: presentation.updatedAt,
      });

      const loaded = await loadPresentation(presentation.id);

      expect(loaded).toEqual({ status: "ok", value: presentation });
      expect(loaded.status === "ok" && "baseUpdatedAt" in loaded.value).toBe(
        false,
      );
    });
  });

  describe("한 브라우저의 소유자 저장본과 공유받은 사본", () => {
    const MEMBER = "0000000x0000000member";

    function sharedCopyOf(presentation: Presentation): Presentation {
      return {
        ...presentation,
        title: "서버에서 받은 제목",
        access: { ownerName: "인도자", memberId: MEMBER },
      };
    }

    it("소유자의 저장본이 있는 자리에는 공유받은 사본을 쓰지 않는다", async () => {
      const owned = makePresentation({ title: "소유자가 고친 제목" });
      await savePresentation(owned);

      await saveSharedPresentation(sharedCopyOf(owned));

      const { valid } = await loadAllPresentations();
      expect(valid).toEqual([owned]);
    });

    it("빈 자리와 공유받은 사본이 있던 자리에는 공유받은 사본을 쓴다", async () => {
      const shared = sharedCopyOf(makePresentation());

      await saveSharedPresentation(shared);
      expect((await loadAllPresentations()).valid).toEqual([shared]);

      await saveSharedPresentation({ ...shared, title: "새로 받은 제목" });
      expect((await loadAllPresentations()).valid).toEqual([
        { ...shared, title: "새로 받은 제목" },
      ]);
    });

    it("공유받은 사본만 지우고 소유자의 저장본은 남긴다", async () => {
      const owned = makePresentation({ title: "소유자의 프레젠테이션" });
      const shared = sharedCopyOf(makePresentation());
      await savePresentation(owned);
      await savePresentation(shared);

      await deleteSharedPresentation(owned.id);
      await deleteSharedPresentation(shared.id);

      const { valid } = await loadAllPresentations();
      expect(valid).toEqual([owned]);
    });
  });
});
