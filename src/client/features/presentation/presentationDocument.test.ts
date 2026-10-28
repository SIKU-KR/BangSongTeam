import { describe, it, expect } from "vitest";
import {
  MAX_PRESENTATION_TITLE_LENGTH,
  PresentationSchema,
  type Presentation,
} from "#shared";
import { COMMON_COPY } from "#copy/common";
import { SEED_PRESENTATIONS } from "../../test/presentationFixture";
import {
  buildPresentationCopy,
  hasUnsyncedEdits,
  isSyncedWithServer,
  repairDuplicateDeckIds,
  withCurrentPlacement,
  withEditStamp,
} from "./presentationDocument";

const SOURCE = SEED_PRESENTATIONS[0];
const NOW = "2026-10-01T09:00:00.000Z";
const OLDER_BASE = "2026-10-01T08:00:00.000Z";
const OTHER_USER = "999999999999999999999";
const FOLDER = "f00000000000000000001";

function withDuplicatedFirstDeck(doc: Presentation): Presentation {
  const [first, second, ...rest] = doc.items;
  return {
    ...doc,
    items: [
      first,
      { ...second, deckId: first.deckId, deck: { ...first.deck!, title: "x" } },
      ...rest,
    ],
  };
}

describe("repairDuplicateDeckIds", () => {
  it("덱 id가 겹치지 않으면 문서를 그대로 돌려준다", () => {
    const { documents, repairedIds } = repairDuplicateDeckIds([SOURCE]);

    expect(documents[0]).toBe(SOURCE);
    expect(repairedIds).toEqual([]);
  });

  it("뒤에 나온 중복 덱에만 새 id를 주고 원래 id를 forkedFrom에 남긴다", () => {
    const broken = withDuplicatedFirstDeck(SOURCE);
    const firstId = broken.items[0].deckId;

    const { documents, repairedIds } = repairDuplicateDeckIds([broken]);
    const [first, second] = documents[0].items;

    expect(repairedIds).toEqual([broken.id]);
    expect(first).toBe(broken.items[0]);
    expect(second.deckId).not.toBe(firstId);
    expect(second.deck?.id).toBe(second.deckId);
    expect(second.deck?.forkedFrom).toBe(firstId);
    expect(() => PresentationSchema.parse(documents[0])).not.toThrow();
  });

  it("item.deckId가 덱 id와 어긋나면 덱 id로 맞춘다", () => {
    const [first, ...rest] = SOURCE.items;
    const mismatched: Presentation = {
      ...SOURCE,
      items: [{ ...first, deckId: "d00000000000000000099" }, ...rest],
    };

    const { documents, repairedIds } = repairDuplicateDeckIds([mismatched]);

    expect(repairedIds).toEqual([SOURCE.id]);
    expect(documents[0].items[0].deckId).toBe(first.deck?.id);
  });
});

describe("withCurrentPlacement", () => {
  it("기록 문서의 내용에 지금 문서의 폴더·휴지통 배치를 입힌다", () => {
    const snapshot: Presentation = {
      ...SOURCE,
      title: "예전 제목",
      folderId: null,
      trashedAt: null,
    };
    const current: Presentation = {
      ...SOURCE,
      folderId: FOLDER,
      trashedAt: NOW,
    };

    const next = withCurrentPlacement(snapshot, current);

    expect(next.title).toBe("예전 제목");
    expect(next.folderId).toBe(FOLDER);
    expect(next.trashedAt).toBe(NOW);
  });

  it("지금 문서에 배치가 없으면 기록 문서의 배치도 지운다", () => {
    const snapshot: Presentation = {
      ...SOURCE,
      folderId: FOLDER,
      trashedAt: NOW,
    };

    const next = withCurrentPlacement(snapshot, SOURCE);

    expect("folderId" in next).toBe(false);
    expect("trashedAt" in next).toBe(false);
    expect(snapshot.folderId).toBe(FOLDER);
  });

  it("지금 문서의 기준 판을 입히고, 지금 문서에 기준 판이 없으면 기록 문서의 것도 지운다", () => {
    const snapshot: Presentation = { ...SOURCE, baseUpdatedAt: OLDER_BASE };
    const current: Presentation = { ...SOURCE, baseUpdatedAt: NOW };

    expect(withCurrentPlacement(snapshot, current).baseUpdatedAt).toBe(NOW);
    expect(
      withCurrentPlacement(snapshot, { ...SOURCE, baseUpdatedAt: null })
        .baseUpdatedAt,
    ).toBeNull();
    expect("baseUpdatedAt" in withCurrentPlacement(snapshot, SOURCE)).toBe(
      false,
    );
  });
});

describe("서버와 맞춘 판인지", () => {
  const at = (updatedAt: string, baseUpdatedAt?: string | null) => ({
    ...SOURCE,
    updatedAt,
    ...(baseUpdatedAt === undefined ? {} : { baseUpdatedAt }),
  });

  it("기준 판과 수정 시각이 같으면 서버와 맞춘 판이다", () => {
    expect(isSyncedWithServer(at(NOW, NOW))).toBe(true);
    expect(hasUnsyncedEdits(at(NOW, NOW))).toBe(false);
  });

  it("기준 판 뒤에 고쳤거나 서버가 확정한 적 없는 판은 올리지 않은 편집이 있다", () => {
    expect(isSyncedWithServer(at(NOW, OLDER_BASE))).toBe(false);
    expect(hasUnsyncedEdits(at(NOW, OLDER_BASE))).toBe(true);
    expect(isSyncedWithServer(at(NOW, null))).toBe(false);
    expect(hasUnsyncedEdits(at(NOW, null))).toBe(true);
  });

  it("기준 판이 없는 이전 저장본은 어느 쪽인지 알 수 없다", () => {
    expect(isSyncedWithServer(at(NOW))).toBe(false);
    expect(hasUnsyncedEdits(at(NOW))).toBe(false);
  });

  it("기준 판보다 이른 시각의 판도 올리지 않은 편집이 있다", () => {
    expect(isSyncedWithServer(at(OLDER_BASE, NOW))).toBe(false);
    expect(hasUnsyncedEdits(at(OLDER_BASE, NOW))).toBe(true);
  });
});

describe("withEditStamp", () => {
  const BASE = "2026-10-01T12:00:00.000Z";
  const HOUR_BEHIND = Date.parse("2026-10-01T11:00:00.000Z");
  const clean: Presentation = {
    ...SOURCE,
    updatedAt: BASE,
    baseUpdatedAt: BASE,
  };

  it("바뀐 것이 없으면 같은 객체를 돌려준다", () => {
    expect(withEditStamp(clean, clean, HOUR_BEHIND)).toBe(clean);
  });

  it("기기 시계가 기준 판보다 한참 늦어도 기준 판보다 늦게 찍는다", () => {
    const edited = withEditStamp(
      clean,
      { ...clean, title: "고친 제목" },
      HOUR_BEHIND,
    );

    expect(edited).toMatchObject({
      title: "고친 제목",
      updatedAt: "2026-10-01T12:00:00.001Z",
      baseUpdatedAt: BASE,
    });
    expect(hasUnsyncedEdits(edited)).toBe(true);
  });

  it("시계가 맞으면 지금으로 찍는다", () => {
    const edited = withEditStamp(
      clean,
      { ...clean, title: "고친 제목" },
      Date.parse("2026-10-01T13:00:00.000Z"),
    );

    expect(edited.updatedAt).toBe("2026-10-01T13:00:00.000Z");
  });

  it("고치기 전 판이 기준 판보다 일러도 기준 판보다 늦게 찍는다", () => {
    const stampedEarlier: Presentation = {
      ...clean,
      updatedAt: "2026-10-01T10:00:00.000Z",
    };

    expect(
      withEditStamp(
        stampedEarlier,
        { ...stampedEarlier, title: "고친 제목" },
        HOUR_BEHIND,
      ).updatedAt,
    ).toBe("2026-10-01T12:00:00.001Z");
  });

  it("기준 판이 없거나 서버가 확정한 적 없는 판도 기기 시계로 줄이지 않고 고치기 전 판보다 늦게 찍는다", () => {
    const legacy: Presentation = { ...SOURCE, updatedAt: BASE };
    const created: Presentation = { ...legacy, baseUpdatedAt: null };

    expect(
      withEditStamp(legacy, { ...legacy, title: "고친 제목" }, HOUR_BEHIND)
        .updatedAt,
    ).toBe("2026-10-01T12:00:00.001Z");
    expect(
      withEditStamp(created, { ...created, title: "고친 제목" }, HOUR_BEHIND)
        .updatedAt,
    ).toBe("2026-10-01T12:00:00.001Z");
  });
});

describe("buildPresentationCopy", () => {
  it("문서·항목·덱 id를 모두 새로 발급하고 소유자·위치·시각을 받은 값으로 둔다", () => {
    const copy = buildPresentationCopy(SOURCE, {
      userId: OTHER_USER,
      folderId: FOLDER,
      now: NOW,
    });

    expect(copy.id).not.toBe(SOURCE.id);
    expect(copy.userId).toBe(OTHER_USER);
    expect(copy.folderId).toBe(FOLDER);
    expect(copy.trashedAt).toBeNull();
    expect(copy.createdAt).toBe(NOW);
    expect(copy.updatedAt).toBe(NOW);
    expect(copy.title).toBe(`${SOURCE.title}${COMMON_COPY.copySuffix}`);
    expect(copy.baseUpdatedAt).toBeNull();

    const sourceItemIds = new Set(SOURCE.items.map((item) => item.id));
    const sourceDeckIds = new Set(SOURCE.items.map((item) => item.deckId));
    for (const item of copy.items) {
      expect(sourceItemIds.has(item.id)).toBe(false);
      expect(sourceDeckIds.has(item.deckId)).toBe(false);
      expect(item.presentationId).toBe(copy.id);
      expect(item.deck?.id).toBe(item.deckId);
      expect(item.deck?.userId).toBe(OTHER_USER);
      expect(item.deck?.presentationId).toBe(copy.id);
      expect(item.deck?.updatedAt).toBe(NOW);
    }
    expect(copy.items.map((item) => item.deck?.title)).toEqual(
      SOURCE.items.map((item) => item.deck?.title),
    );
    expect(() => PresentationSchema.parse(copy)).not.toThrow();
  });

  it("사본 표시를 붙여도 제목이 최대 길이를 넘지 않는다", () => {
    const longTitle = "가".repeat(MAX_PRESENTATION_TITLE_LENGTH);

    const copy = buildPresentationCopy(
      { ...SOURCE, title: longTitle },
      { userId: OTHER_USER, folderId: null, now: NOW },
    );

    expect(copy.title).toHaveLength(MAX_PRESENTATION_TITLE_LENGTH);
    expect(copy.title.endsWith(COMMON_COPY.copySuffix)).toBe(true);
  });

  it("휴지통 시각을 주면 그대로 두고, 서버가 확정한 적 없는 판으로 만든다", () => {
    const copy = buildPresentationCopy(
      { ...SOURCE, baseUpdatedAt: OLDER_BASE, trashedAt: NOW },
      { userId: OTHER_USER, folderId: FOLDER, trashedAt: NOW, now: NOW },
    );

    expect(copy.folderId).toBe(FOLDER);
    expect(copy.trashedAt).toBe(NOW);
    expect(copy.baseUpdatedAt).toBeNull();
  });

  it("공유 정보는 떼어 내고 원본 덱은 건드리지 않는다", () => {
    const shared: Presentation = {
      ...SOURCE,
      access: { ownerName: "인도자" },
    };

    const copy = buildPresentationCopy(shared, {
      userId: OTHER_USER,
      folderId: null,
      now: NOW,
    });

    expect("access" in copy).toBe(false);
    expect(copy.items[0].deck).not.toBe(SOURCE.items[0].deck);
    expect(SOURCE.items[0].deck?.userId).not.toBe(OTHER_USER);
  });
});
