import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createId, type Presentation } from "#shared";
import { COMMON_COPY } from "#copy/common";
import {
  getOfflineDB,
  closeOfflineDB,
  OFFLINE_DB_NAME,
  type WorshipOfflineDB,
} from "./db";
import {
  savePresentation,
  savePresentationIfUnchanged,
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

    it("기준 판(baseUpdatedAt)을 함께 읽고, 스키마에 없는 필드는 떼고 읽는다", async () => {
      const presentation = makePresentation({
        baseUpdatedAt: "2026-09-27T00:00:00.000Z",
      });
      await seedRawRecord({ ...presentation, notYetKnown: "새 버전의 필드" });

      const loaded = await loadPresentation(presentation.id);

      expect(loaded).toEqual({ status: "ok", value: presentation });
      expect(loaded.status === "ok" && "notYetKnown" in loaded.value).toBe(
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

  describe("한도를 넘는 저장본과 읽지 못한 저장본", () => {
    const T1 = "2026-09-25T00:00:00.000Z";
    const T2 = "2026-09-26T00:00:00.000Z";
    const T3 = "2026-09-27T00:00:00.000Z";
    const LONG_TITLE = "가".repeat(150);
    const FITTED_TITLE = "가".repeat(100);

    async function rowAt(key: string): Promise<unknown> {
      const db = await getOfflineDB();
      return db.get("presentations", key);
    }

    async function storedKeys(): Promise<string[]> {
      const db = await getOfflineDB();
      const keys = await db.getAllKeys("presentations");
      return keys.map(String).sort();
    }

    function keptKey(id: string, updatedAt: string): string {
      return `${id}#kept#${updatedAt}`;
    }

    function unreadableRow(
      id: string,
      updatedAt: string,
      title = "새 버전이 쓴 판",
    ): Record<string, unknown> {
      return {
        ...makePresentation({ id, updatedAt, title }),
        serviceDate: "nope",
      };
    }

    function overLimitRow(
      id: string,
      updatedAt: string,
    ): Record<string, unknown> {
      return { ...makePresentation({ id, updatedAt }), title: LONG_TITLE };
    }

    it("글 한도만 넘은 저장본은 줄여 싣고 고친 id로 알리며, 저장본은 그대로 둔다", async () => {
      const id = createId();
      const row = overLimitRow(id, T2);
      await seedRawRecord(row);

      const { valid, corrupted, repairedIds } = await loadAllPresentations();

      expect(valid).toHaveLength(1);
      expect(valid[0]).toMatchObject({
        id,
        title: FITTED_TITLE,
        updatedAt: T2,
      });
      expect(repairedIds).toEqual([id]);
      expect(corrupted).toEqual([]);
      expect(await rowAt(id)).toEqual(row);
    });

    it("읽지 못한 저장본은 한 번만 알리고 그 자리에 그대로 둔다", async () => {
      const id = createId();
      const row = unreadableRow(id, T2);
      await seedRawRecord(row);

      const { valid, corrupted, repairedIds } = await loadAllPresentations();

      expect(valid).toEqual([]);
      expect(repairedIds).toEqual([]);
      expect(corrupted).toEqual([{ id }]);
      expect(await storedKeys()).toEqual([id]);
      expect(await rowAt(id)).toEqual(row);
    });

    describe("싣다가 읽지 못한 저장본을 덮을 때", () => {
      it("덮기 전에 그 판을 보관하고, 다시 저장할 때는 더 보관하지 않는다", async () => {
        const id = createId();
        const raw = unreadableRow(id, T2);
        await seedRawRecord(raw);
        await loadAllPresentations();
        const server = makePresentation({ id, updatedAt: T1 });

        await savePresentation(server);
        await savePresentation({ ...server, title: "다시 저장한 제목" });

        expect(await rowAt(id)).toEqual({
          ...server,
          title: "다시 저장한 제목",
        });
        expect(await rowAt(keptKey(id, T2))).toEqual({
          ...raw,
          id: keptKey(id, T2),
        });
        expect(await storedKeys()).toEqual([id, keptKey(id, T2)].sort());
      });

      it("보관한 판은 덮지 않고, 다음에 읽지 못한 다른 판도 따로 보관한다", async () => {
        const id = createId();
        await seedRawRecord(unreadableRow(id, T2));
        await loadAllPresentations();
        await savePresentation(makePresentation({ id, updatedAt: T1 }));
        const keptAtT2 = await rowAt(keptKey(id, T2));

        const newer = unreadableRow(id, T3);
        await seedRawRecord(newer);
        await loadAllPresentations();
        await savePresentation(makePresentation({ id, updatedAt: T1 }));

        expect(await rowAt(keptKey(id, T2))).toEqual(keptAtT2);
        expect(await rowAt(keptKey(id, T3))).toEqual({
          ...newer,
          id: keptKey(id, T3),
        });
        expect(await storedKeys()).toEqual(
          [id, keptKey(id, T2), keptKey(id, T3)].sort(),
        );
      });

      it("같은 updatedAt의 보관본이 이미 있으면 그 보관본을 덮지 않는다", async () => {
        const id = createId();
        await seedRawRecord(unreadableRow(id, T2, "먼저 보관한 판"));
        await loadAllPresentations();
        await savePresentation(makePresentation({ id, updatedAt: T1 }));
        const kept = await rowAt(keptKey(id, T2));

        await seedRawRecord(unreadableRow(id, T2, "같은 시각의 다른 판"));
        await loadAllPresentations();
        await savePresentation(makePresentation({ id, updatedAt: T1 }));

        expect(await rowAt(keptKey(id, T2))).toEqual(kept);
      });

      it("저장할 판이 읽지 못한 저장본과 같은 updatedAt이면 보관하지 않는다", async () => {
        const id = createId();
        await seedRawRecord(unreadableRow(id, T2));
        await loadAllPresentations();
        const same = makePresentation({ id, updatedAt: T2 });

        await savePresentation(same);

        expect(await storedKeys()).toEqual([id]);
        expect(await rowAt(id)).toEqual(same);
      });

      it("두 저장이 함께 덮어도 보관본은 하나만 남긴다", async () => {
        const id = createId();
        const raw = unreadableRow(id, T2);
        await seedRawRecord(raw);
        await loadAllPresentations();

        await Promise.all([
          savePresentation(makePresentation({ id, updatedAt: T1 })),
          savePresentation(makePresentation({ id, updatedAt: T3 })),
        ]);

        expect(await storedKeys()).toEqual([id, keptKey(id, T2)].sort());
        expect(await rowAt(keptKey(id, T2))).toEqual({
          ...raw,
          id: keptKey(id, T2),
        });
      });

      it("한 건 읽기에서 읽지 못한 저장본도 덮기 전에 보관한다", async () => {
        const id = createId();
        const raw = unreadableRow(id, T2);
        await seedRawRecord(raw);

        expect(await loadPresentation(id)).toEqual({ status: "unreadable" });
        await savePresentation(makePresentation({ id, updatedAt: T1 }));

        expect(await rowAt(keptKey(id, T2))).toEqual({
          ...raw,
          id: keptKey(id, T2),
        });
      });

      it("읽지 못한 공유받은 사본을 덮을 때도 보관한다", async () => {
        const id = createId();
        const access = {
          ownerName: "인도자",
          memberId: "0000000x0000000member",
        };
        const raw = { ...unreadableRow(id, T2), access };
        await seedRawRecord(raw);
        await loadAllPresentations();
        const shared = makePresentation({ id, updatedAt: T1, access });

        await saveSharedPresentation(shared);

        expect(await rowAt(id)).toEqual(shared);
        expect(await rowAt(keptKey(id, T2))).toEqual({
          ...raw,
          id: keptKey(id, T2),
        });
      });
    });

    it("한 건 읽기는 글 한도만 넘은 저장본을 줄여 읽는다", async () => {
      const id = createId();
      await seedRawRecord(overLimitRow(id, T2));

      const loaded = await loadPresentation(id);

      expect(loaded.status === "ok" && loaded.value.title).toBe(FITTED_TITLE);
    });

    describe("보관본 고치기", () => {
      it("읽을 수 있게 된 보관본이 지금 판보다 새로우면 그 판을 되살리고 보관본을 지운다", async () => {
        const id = createId();
        await savePresentation(makePresentation({ id, updatedAt: T1 }));
        await seedRawRecord({ ...overLimitRow(id, T2), id: keptKey(id, T2) });

        const { valid, corrupted, restoredIds } = await loadAllPresentations();

        expect(valid).toHaveLength(1);
        expect(valid[0]).toMatchObject({
          id,
          updatedAt: T2,
          title: FITTED_TITLE,
        });
        expect(corrupted).toEqual([]);
        expect(restoredIds).toEqual([id]);
        expect(await storedKeys()).toEqual([id]);
        expect(await rowAt(id)).toEqual(valid[0]);
      });

      it("지금 판이 더 새로우면 지금 판을 두고 보관본을 지운다", async () => {
        const id = createId();
        const current = makePresentation({ id, updatedAt: T3 });
        await savePresentation(current);
        await seedRawRecord({ ...overLimitRow(id, T2), id: keptKey(id, T2) });

        const { valid, corrupted, restoredIds } = await loadAllPresentations();

        expect(valid).toEqual([current]);
        expect(corrupted).toEqual([]);
        expect(restoredIds).toEqual([]);
        expect(await storedKeys()).toEqual([id]);
      });

      it("지금 저장본을 읽지 못하면 읽을 수 있는 보관본도 그대로 두고, 그 자리를 덮은 다음에 되살린다", async () => {
        const id = createId();
        const unreadable = unreadableRow(id, T3);
        const keptAtT2 = { ...overLimitRow(id, T2), id: keptKey(id, T2) };
        await seedRawRecord(unreadable);
        await seedRawRecord(keptAtT2);

        const first = await loadAllPresentations();

        expect(first.valid).toEqual([]);
        expect(first.corrupted).toEqual([{ id }]);
        expect(first.restoredIds).toEqual([]);
        expect(await rowAt(id)).toEqual(unreadable);
        expect(await rowAt(keptKey(id, T2))).toEqual(keptAtT2);

        await savePresentation(makePresentation({ id, updatedAt: T1 }));
        const second = await loadAllPresentations();

        expect(second.valid).toHaveLength(1);
        expect(second.valid[0]).toMatchObject({
          id,
          updatedAt: T2,
          title: FITTED_TITLE,
        });
        expect(second.corrupted).toEqual([{ id }]);
        expect(second.restoredIds).toEqual([id]);
        expect(await rowAt(id)).toEqual(second.valid[0]);
        expect(await rowAt(keptKey(id, T3))).toEqual({
          ...unreadable,
          id: keptKey(id, T3),
        });
        expect(await storedKeys()).toEqual([id, keptKey(id, T3)].sort());
      });

      it("아직 읽지 못하는 보관본은 남기고 원래 id로 한 번만 알린다", async () => {
        const id = createId();
        const current = makePresentation({ id, updatedAt: T1 });
        await savePresentation(current);
        await seedRawRecord({ ...unreadableRow(id, T2), id: keptKey(id, T2) });
        await seedRawRecord({ ...unreadableRow(id, T3), id: keptKey(id, T3) });

        const { valid, corrupted } = await loadAllPresentations();

        expect(valid).toEqual([current]);
        expect(corrupted).toEqual([{ id }]);
        expect(await storedKeys()).toEqual(
          [id, keptKey(id, T2), keptKey(id, T3)].sort(),
        );
      });

      it("공유받은 사본의 보관본은 소유자 저장본 자리에 되살리지 않는다", async () => {
        const id = createId();
        const owned = makePresentation({ id, updatedAt: T1 });
        await savePresentation(owned);
        await seedRawRecord({
          ...makePresentation({
            id,
            updatedAt: T2,
            access: { ownerName: "인도자", memberId: "0000000x0000000member" },
          }),
          id: keptKey(id, T2),
        });

        const { valid, corrupted, restoredIds } = await loadAllPresentations();

        expect(valid).toEqual([owned]);
        expect(corrupted).toEqual([]);
        expect(restoredIds).toEqual([]);
        expect(await storedKeys()).toEqual([id]);
      });

      it("원래 저장본이 없는 보관본은 지운다", async () => {
        const id = createId();
        await seedRawRecord({ ...unreadableRow(id, T2), id: keptKey(id, T2) });
        await seedRawRecord({ ...overLimitRow(id, T3), id: keptKey(id, T3) });

        const { valid, corrupted } = await loadAllPresentations();

        expect(valid).toEqual([]);
        expect(corrupted).toEqual([]);
        expect(await storedKeys()).toEqual([]);
      });

      describe("올리지 않은 편집이 있는 보관본", () => {
        const S1 = "2026-09-25T00:00:00.000Z";
        const S1_EDIT = "2026-09-25T00:00:00.001Z";
        const S2 = "2026-09-26T00:00:00.000Z";
        const S2_EDIT = "2026-09-26T00:05:00.000Z";
        const FOLDER = "a00000000000000000001";

        function syncedAt(
          id: string,
          at: string,
          title = "서버와 맞춘 판",
        ): Presentation {
          return makePresentation({
            id,
            title,
            updatedAt: at,
            baseUpdatedAt: at,
          });
        }

        function editedOn(
          id: string,
          base: string,
          at: string,
          title: string,
        ): Presentation {
          return makePresentation({
            id,
            title,
            folderId: FOLDER,
            trashedAt: null,
            updatedAt: at,
            baseUpdatedAt: base,
          });
        }

        async function keep(doc: Presentation): Promise<void> {
          await seedRawRecord({ ...doc, id: keptKey(doc.id, doc.updatedAt) });
        }

        it("서버와 맞춘 지금 판보다 수정 시각이 이르더라도 그 판 대신 되살린다", async () => {
          const id = createId();
          await savePresentation(syncedAt(id, S2));
          const edited = editedOn(id, S1, S1_EDIT, "시계가 늦은 기기의 편집");
          await keep(edited);

          const { valid, corrupted, restoredIds } =
            await loadAllPresentations();

          expect(valid).toEqual([edited]);
          expect(corrupted).toEqual([]);
          expect(restoredIds).toEqual([id]);
          expect(await storedKeys()).toEqual([id]);
          expect(await rowAt(id)).toEqual(edited);
        });

        it("지금 판도 올리지 않은 편집이면 지금 판을 두고, 보관본의 편집은 같은 폴더의 새 사본으로 남긴다", async () => {
          const id = createId();
          const current = editedOn(id, S2, S2_EDIT, "이 기기의 편집");
          await savePresentation(current);
          await keep(editedOn(id, S1, S1_EDIT, "보관본의 편집"));

          const { valid, corrupted, restoredIds } =
            await loadAllPresentations();

          const copy = valid.find((doc) => doc.id !== id);
          expect(valid.find((doc) => doc.id === id)).toEqual(current);
          expect(copy).toMatchObject({
            title: `보관본의 편집${COMMON_COPY.copySuffix}`,
            folderId: FOLDER,
            trashedAt: null,
            baseUpdatedAt: null,
          });
          expect(corrupted).toEqual([]);
          expect(restoredIds).toEqual([copy?.id]);
          expect(await storedKeys()).toEqual([id, copy?.id].sort());
          expect(await rowAt(copy!.id)).toEqual(copy);
        });

        it("지금 판이 올리지 않은 편집이면 더 새로운 맞춘 보관본으로 덮지 않는다", async () => {
          const id = createId();
          const current = editedOn(id, S1, S1_EDIT, "이 기기의 편집");
          await savePresentation(current);
          await keep(syncedAt(id, S2, "더 새로운 서버 판"));

          const { valid, restoredIds } = await loadAllPresentations();

          expect(valid).toEqual([current]);
          expect(restoredIds).toEqual([]);
          expect(await storedKeys()).toEqual([id]);
        });

        it("내용이 지금 판과 같은 보관본은 사본 없이 지운다", async () => {
          const id = createId();
          const current = editedOn(id, S2, S2_EDIT, "같은 편집");
          await savePresentation(current);
          await keep({ ...current, updatedAt: S1_EDIT, baseUpdatedAt: S1 });

          const { valid, restoredIds } = await loadAllPresentations();

          expect(valid).toEqual([current]);
          expect(restoredIds).toEqual([]);
          expect(await storedKeys()).toEqual([id]);
        });

        it("서버와 맞춘 지금 판에 편집한 보관본이 여럿이면 가장 새 편집을 되살리고 나머지는 사본으로 남긴다", async () => {
          const id = createId();
          await savePresentation(syncedAt(id, S2));
          const older = editedOn(id, S1, S1_EDIT, "먼저 고친 편집");
          const newer = editedOn(id, S1, S2_EDIT, "나중에 고친 편집");
          await keep(older);
          await keep(newer);

          const { valid, restoredIds } = await loadAllPresentations();

          const copy = valid.find((doc) => doc.id !== id);
          expect(valid.find((doc) => doc.id === id)).toEqual(newer);
          expect(copy?.title).toBe(`먼저 고친 편집${COMMON_COPY.copySuffix}`);
          expect(restoredIds).toEqual([id, copy?.id]);
          expect(await storedKeys()).toEqual([id, copy?.id].sort());
        });
      });

      it("두 탭이 함께 고쳐도 둘 다 되살린 판을 싣고 저장본에는 한 번만 둔다", async () => {
        const id = createId();
        await savePresentation(makePresentation({ id, updatedAt: T1 }));
        const kept = makePresentation({
          id,
          updatedAt: T2,
          title: "되살릴 판",
        });
        await seedRawRecord({ ...kept, id: keptKey(id, T2) });

        const [first, second] = await Promise.all([
          loadAllPresentations(),
          loadAllPresentations(),
        ]);

        expect(first.valid).toEqual([kept]);
        expect(second.valid).toEqual([kept]);
        expect([...first.restoredIds, ...second.restoredIds]).toEqual([id]);
        expect(await storedKeys()).toEqual([id]);
        expect(await rowAt(id)).toEqual(kept);
      });
    });

    it("프레젠테이션을 지우면 그 보관본도 모두 지운다", async () => {
      const id = createId();
      const other = makePresentation();
      await savePresentation(makePresentation({ id, updatedAt: T3 }));
      await seedRawRecord({ ...unreadableRow(id, T1), id: keptKey(id, T1) });
      await seedRawRecord({ ...unreadableRow(id, T2), id: keptKey(id, T2) });
      await savePresentation(other);
      await seedRawRecord({
        ...unreadableRow(other.id, T2),
        id: keptKey(other.id, T2),
      });

      await deletePresentation(id);

      expect(await storedKeys()).toEqual(
        [other.id, keptKey(other.id, T2)].sort(),
      );
    });

    describe("바뀌지 않았을 때만 쓰기 (savePresentationIfUnchanged)", () => {
      it("저장본의 updatedAt이 같으면 쓴다", async () => {
        const id = createId();
        await seedRawRecord(overLimitRow(id, T2));
        const fitted = makePresentation({
          id,
          updatedAt: T2,
          title: FITTED_TITLE,
        });

        expect(await savePresentationIfUnchanged(fitted)).toBe(true);

        expect(await rowAt(id)).toEqual(fitted);
      });

      it("그사이 다른 쓰기가 저장본을 바꿨으면 쓰지 않는다", async () => {
        const id = createId();
        await seedRawRecord(overLimitRow(id, T2));
        const rewritten = makePresentation({ id, updatedAt: T3 });
        await savePresentation(rewritten);

        expect(
          await savePresentationIfUnchanged(
            makePresentation({ id, updatedAt: T2, title: FITTED_TITLE }),
          ),
        ).toBe(false);

        expect(await rowAt(id)).toEqual(rewritten);
      });

      it("저장본이 없으면 쓰지 않는다", async () => {
        const doc = makePresentation();

        expect(await savePresentationIfUnchanged(doc)).toBe(false);

        expect(await storedKeys()).toEqual([]);
      });

      it("소유자의 저장본이 같은 판이어도 공유받은 사본으로 덮지 않는다", async () => {
        const owned = makePresentation({ updatedAt: T2 });
        await savePresentation(owned);

        expect(
          await savePresentationIfUnchanged({
            ...owned,
            access: { ownerName: "인도자", memberId: "0000000x0000000member" },
          }),
        ).toBe(false);

        expect(await rowAt(owned.id)).toEqual(owned);
      });
    });
  });
});
