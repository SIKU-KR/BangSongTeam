import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  OmittedPresentation,
  Presentation,
  PresentationDocument,
  PresentationListEntry,
} from "#shared";
import { mockPresentation } from "../../test/presentationFixture";
import { ServerRejectedError } from "../api/request";
import { __resetServerClockForTests } from "../api/serverClock";
import {
  MAX_SEPARATE_PULLS,
  PULL_SINCE_MARGIN_MS,
  notePresentationsPulled,
  pullServerPresentations,
  type PresentationPullOptions,
} from "./presentationPull";

const presentationSync = vi.hoisted(() => ({
  pullPresentations: vi.fn<
    (since?: string) => Promise<PresentationListEntry[]>
  >(async () => []),
  pullPresentation: vi.fn<(id: string) => Promise<PresentationDocument | null>>(
    async () => null,
  ),
}));

vi.mock("./presentationSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./presentationSync")>();
  return { ...actual, ...presentationSync };
});

const USER = mockPresentation.userId;
const OTHER_USER = "00000000x000000000009";
const NOW = Date.parse("2026-10-28T09:00:00.000Z");
const R1 = "2026-10-20T00:00:00.000Z";
const R2 = "2026-10-21T00:00:00.000Z";
const EDITED = "2026-10-22T00:00:00.000Z";

function synced(overrides: Partial<Presentation> = {}): Presentation {
  return {
    ...structuredClone(mockPresentation),
    updatedAt: R1,
    baseUpdatedAt: R1,
    folderId: null,
    trashedAt: null,
    ...overrides,
  };
}

function serverCopy(doc: Presentation): PresentationDocument {
  const copy = structuredClone(doc) as PresentationDocument;
  delete copy.baseUpdatedAt;
  return copy;
}

function headerOf(
  doc: Presentation,
  overrides: Partial<OmittedPresentation> = {},
): OmittedPresentation {
  return {
    id: doc.id,
    userId: doc.userId,
    title: doc.title,
    serviceDate: doc.serviceDate,
    folderId: doc.folderId ?? null,
    trashedAt: doc.trashedAt ?? null,
    ...(doc.access ? { access: doc.access } : {}),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    items: null,
    copiesOmitted: true,
    ...overrides,
  };
}

function withId(doc: Presentation, id: string): Presentation {
  return { ...doc, id, items: doc.items.map((item) => ({ ...item })) };
}

function options(
  local: readonly Presentation[],
  overrides: Partial<PresentationPullOptions> = {},
): PresentationPullOptions {
  return { local: () => local, proceed: () => true, ...overrides };
}

function sinceSent(call = -1): string | undefined {
  return presentationSync.pullPresentations.mock.calls.at(call)?.[0];
}

describe("pullServerPresentations — 바뀐 프레젠테이션만 곡까지 받기", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetServerClockForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    presentationSync.pullPresentations.mockReset();
    presentationSync.pullPresentations.mockResolvedValue([]);
    presentationSync.pullPresentation.mockReset();
    presentationSync.pullPresentation.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("받은 시각을 남긴 적 없는 기기는 since 없이 목록 전체를 받는다", async () => {
    const doc = serverCopy(synced());
    presentationSync.pullPresentations.mockResolvedValue([doc]);

    const pull = await pullServerPresentations(USER, options([]));

    expect(sinceSent()).toBeUndefined();
    expect(pull).toEqual({ documents: [doc], startedAt: NOW });
  });

  it("반영을 마치고 남긴 받은 시각보다 여유만큼 앞선 때를 since로 보낸다", async () => {
    const first = await pullServerPresentations(USER, options([]));
    expect(sinceSent()).toBeUndefined();
    notePresentationsPulled(USER, first as NonNullable<typeof first>);

    vi.setSystemTime(NOW + 60_000);
    await pullServerPresentations(USER, options([]));

    expect(sinceSent()).toBe(
      new Date(NOW - PULL_SINCE_MARGIN_MS).toISOString(),
    );
  });

  it("받은 시각을 남기지 않은 받기는 다음 받기의 since를 바꾸지 않는다", async () => {
    notePresentationsPulled(USER, { documents: [], startedAt: NOW });
    vi.setSystemTime(NOW + 60_000);

    await pullServerPresentations(USER, options([]));
    await pullServerPresentations(USER, options([]));

    expect(sinceSent()).toBe(
      new Date(NOW - PULL_SINCE_MARGIN_MS).toISOString(),
    );
  });

  it("받은 시각은 사용자마다 따로 두고, 로그인하지 않았으면 쓰지 않는다", async () => {
    notePresentationsPulled(USER, { documents: [], startedAt: NOW });

    await pullServerPresentations(OTHER_USER, options([]));
    expect(sinceSent()).toBeUndefined();

    await pullServerPresentations(null, options([]));
    expect(sinceSent()).toBeUndefined();
    notePresentationsPulled(null, { documents: [], startedAt: NOW });
  });

  it("남긴 받은 시각이 ISO 시각이 아니면 목록 전체를 받는다", async () => {
    localStorage.setItem(`presentation-pull:${USER}`, "어제");

    await pullServerPresentations(USER, options([]));

    expect(sinceSent()).toBeUndefined();
  });

  describe("곡을 뺀 머리", () => {
    beforeEach(() => {
      notePresentationsPulled(USER, { documents: [], startedAt: NOW });
    });

    it("이 기기에 같은 판이 있으면 따로 받지 않고 그 판을 쓴다", async () => {
      const local = synced();
      const changed = serverCopy(
        withId(synced({ updatedAt: R2 }), "1".repeat(21)),
      );
      presentationSync.pullPresentations.mockResolvedValue([
        changed,
        headerOf(local),
      ]);

      const pull = await pullServerPresentations(USER, options([local]));

      expect(presentationSync.pullPresentation).not.toHaveBeenCalled();
      expect(pull?.documents).toEqual([changed, local]);
      expect(pull?.documents[1]).toBe(local);
    });

    it("기준 판이 없는 이전 저장본도 판과 머리가 같으면 그대로 쓴다", async () => {
      const legacy = synced();
      delete legacy.baseUpdatedAt;
      presentationSync.pullPresentations.mockResolvedValue([headerOf(legacy)]);

      const pull = await pullServerPresentations(USER, options([legacy]));

      expect(presentationSync.pullPresentation).not.toHaveBeenCalled();
      expect(pull?.documents).toEqual([legacy]);
    });

    it("이 기기에 없거나 판이 다르면 그 프레젠테이션만 따로 받는다", async () => {
      const older = synced();
      const missing = withId(synced(), "2".repeat(21));
      const server = serverCopy({ ...older, updatedAt: R2 });
      const fetched = serverCopy(missing);
      presentationSync.pullPresentations.mockResolvedValue([
        headerOf(server),
        headerOf(missing),
      ]);
      presentationSync.pullPresentation.mockImplementation(async (id) =>
        id === older.id ? server : fetched,
      );

      const pull = await pullServerPresentations(USER, options([older]));

      expect(
        presentationSync.pullPresentation.mock.calls.map(([id]) => id),
      ).toEqual([older.id, missing.id]);
      expect(pull?.documents).toEqual([server, fetched]);
    });

    it("올리지 않은 편집이 있는 세트는 서버 판이 기준 판 그대로여도 따로 받는다", async () => {
      const edited = synced({ updatedAt: EDITED, baseUpdatedAt: R1 });
      const server = serverCopy(synced());
      presentationSync.pullPresentations.mockResolvedValue([headerOf(server)]);
      presentationSync.pullPresentation.mockResolvedValue(server);

      const pull = await pullServerPresentations(USER, options([edited]));

      expect(presentationSync.pullPresentation).toHaveBeenCalledWith(edited.id);
      expect(pull?.documents).toEqual([server]);
    });

    it("올리지 않은 편집의 시각이 우연히 서버 판과 같아도 따로 받는다", async () => {
      const edited = synced({ updatedAt: R2, baseUpdatedAt: R1 });
      const server = serverCopy(synced({ updatedAt: R2, title: "다른 기기" }));
      presentationSync.pullPresentations.mockResolvedValue([
        headerOf(server, { title: edited.title }),
      ]);
      presentationSync.pullPresentation.mockResolvedValue(server);

      const pull = await pullServerPresentations(USER, options([edited]));

      expect(presentationSync.pullPresentation).toHaveBeenCalledWith(edited.id);
      expect(pull?.documents).toEqual([server]);
    });

    it("서버에 확정된 적 없는 세트(기준 판 null)는 판이 같아도 따로 받는다", async () => {
      const unconfirmed = synced({ baseUpdatedAt: null });
      const server = serverCopy(synced());
      presentationSync.pullPresentations.mockResolvedValue([headerOf(server)]);
      presentationSync.pullPresentation.mockResolvedValue(server);

      await pullServerPresentations(USER, options([unconfirmed]));

      expect(presentationSync.pullPresentation).toHaveBeenCalledTimes(1);
    });

    it("판이 같아도 서버가 머리를 고쳤으면(폴더·휴지통·제목·날짜) 따로 받는다", async () => {
      const local = synced({ folderId: "f".repeat(21) });
      const headers = [
        headerOf(local, { folderId: null }),
        headerOf(local, { trashedAt: R1 }),
        headerOf(local, { title: "서버가 고친 제목" }),
        headerOf(local, { serviceDate: "2026-10-25" }),
      ];

      for (const header of headers) {
        presentationSync.pullPresentation.mockClear();
        presentationSync.pullPresentation.mockResolvedValue(serverCopy(local));
        presentationSync.pullPresentations.mockResolvedValue([header]);

        await pullServerPresentations(USER, options([local]));

        expect(presentationSync.pullPresentation).toHaveBeenCalledTimes(1);
      }
    });

    it("곡이 빠진 항목이 있는 세트는 판이 같아도 따로 받는다", async () => {
      const broken = synced();
      broken.items = [{ ...broken.items[0], deck: undefined }];
      presentationSync.pullPresentations.mockResolvedValue([headerOf(broken)]);
      presentationSync.pullPresentation.mockResolvedValue(serverCopy(synced()));

      await pullServerPresentations(USER, options([broken]));

      expect(presentationSync.pullPresentation).toHaveBeenCalledWith(broken.id);
    });

    it("판의 시각은 같은 순간이면 표기가 달라도 같은 판으로 본다", async () => {
      const local = synced({
        updatedAt: "2026-10-20T00:00:00Z",
        baseUpdatedAt: "2026-10-20T00:00:00Z",
      });
      presentationSync.pullPresentations.mockResolvedValue([
        headerOf(local, { updatedAt: R1 }),
      ]);

      const pull = await pullServerPresentations(USER, options([local]));

      expect(presentationSync.pullPresentation).not.toHaveBeenCalled();
      expect(pull?.documents).toEqual([local]);
    });

    it("공유받은 세트는 공유 정보까지 같아야 그대로 쓴다", async () => {
      const shared = synced({
        userId: OTHER_USER,
        access: { ownerName: "인도자", memberId: USER },
      });
      delete shared.baseUpdatedAt;
      presentationSync.pullPresentations.mockResolvedValue([headerOf(shared)]);

      const same = await pullServerPresentations(USER, options([shared]));
      expect(same?.documents).toEqual([shared]);
      expect(presentationSync.pullPresentation).not.toHaveBeenCalled();

      presentationSync.pullPresentations.mockResolvedValue([
        headerOf(shared, {
          access: { ownerName: "이름을 바꾼 인도자", memberId: USER },
        }),
      ]);
      presentationSync.pullPresentation.mockResolvedValue(serverCopy(shared));

      await pullServerPresentations(USER, options([shared]));

      expect(presentationSync.pullPresentation).toHaveBeenCalledWith(shared.id);
    });

    it("병합이 이 기기의 세트를 그대로 둘 머리(keepsLocal)는 따로 받지 않고 목록에서 뺀다", async () => {
      const edited = synced({ updatedAt: EDITED, baseUpdatedAt: R1 });
      const missing = withId(synced(), "3".repeat(21));
      const keepsLocal = vi.fn(() => true);
      presentationSync.pullPresentations.mockResolvedValue([
        headerOf(synced()),
        headerOf(missing),
      ]);
      presentationSync.pullPresentation.mockResolvedValue(serverCopy(missing));

      const pull = await pullServerPresentations(
        USER,
        options([edited], { keepsLocal }),
      );

      expect(keepsLocal).toHaveBeenCalledWith(edited, headerOf(synced()));
      expect(
        presentationSync.pullPresentation.mock.calls.map(([id]) => id),
      ).toEqual([missing.id]);
      expect(pull?.documents).toEqual([serverCopy(missing)]);
    });

    it(`따로 받을 프레젠테이션이 ${MAX_SEPARATE_PULLS}개를 넘으면 목록 전체를 한 번 받는다`, async () => {
      const headers = Array.from({ length: MAX_SEPARATE_PULLS + 1 }, (_, n) =>
        headerOf(withId(synced(), `p${String(n).padStart(20, "0")}`)),
      );
      const whole = [serverCopy(synced())];
      presentationSync.pullPresentations
        .mockResolvedValueOnce(headers)
        .mockResolvedValueOnce(whole);

      const pull = await pullServerPresentations(USER, options([]));

      expect(presentationSync.pullPresentation).not.toHaveBeenCalled();
      expect(presentationSync.pullPresentations).toHaveBeenCalledTimes(2);
      expect(sinceSent()).toBeUndefined();
      expect(pull).toEqual({ documents: whole, startedAt: NOW });
    });

    it("따로 받는 사이 사라진 프레젠테이션이 있으면 목록 전체를 다시 받는다", async () => {
      const missing = withId(synced(), "4".repeat(21));
      const whole = [serverCopy(synced())];
      presentationSync.pullPresentations
        .mockResolvedValueOnce([headerOf(missing)])
        .mockResolvedValueOnce(whole);
      presentationSync.pullPresentation.mockResolvedValue(null);

      const pull = await pullServerPresentations(USER, options([]));

      expect(sinceSent()).toBeUndefined();
      expect(pull?.documents).toEqual(whole);
    });

    it("머리 모양이 맞지 않으면 그 목록을 믿지 않고 목록 전체를 받는다", async () => {
      const whole = [serverCopy(synced())];
      presentationSync.pullPresentations
        .mockResolvedValueOnce([
          { ...headerOf(synced()), updatedAt: "어제" } as OmittedPresentation,
        ])
        .mockResolvedValueOnce(whole);

      const pull = await pullServerPresentations(USER, options([synced()]));

      expect(presentationSync.pullPresentations).toHaveBeenCalledTimes(2);
      expect(sinceSent()).toBeUndefined();
      expect(pull?.documents).toEqual(whole);
    });

    it("목록 전체를 다시 받았는데도 머리가 섞여 있으면 받기를 실패로 끝낸다", async () => {
      presentationSync.pullPresentations.mockResolvedValue([
        headerOf(withId(synced(), "8".repeat(21))),
      ]);

      await expect(
        pullServerPresentations(USER, options([])),
      ).rejects.toThrow();
      expect(presentationSync.pullPresentations).toHaveBeenCalledTimes(2);
      expect(sinceSent()).toBeUndefined();
    });

    it("서버가 since를 거절하면(400) 받은 시각을 지우고 곧바로 목록 전체를 받는다", async () => {
      const whole = [serverCopy(synced())];
      presentationSync.pullPresentations
        .mockRejectedValueOnce(new ServerRejectedError(400))
        .mockResolvedValueOnce(whole);

      const pull = await pullServerPresentations(USER, options([]));
      await pullServerPresentations(USER, options([]));

      expect(pull).toEqual({ documents: whole, startedAt: NOW });
      expect(sinceSent(0)).toBe(
        new Date(NOW - PULL_SINCE_MARGIN_MS).toISOString(),
      );
      expect(sinceSent(1)).toBeUndefined();
      expect(sinceSent(2)).toBeUndefined();
    });

    it("since를 거절당한 뒤 다시 받기 전에도 멈출지 묻는다", async () => {
      presentationSync.pullPresentations.mockRejectedValueOnce(
        new ServerRejectedError(400),
      );
      const proceed = vi.fn(() => false);

      const pull = await pullServerPresentations(
        USER,
        options([], { proceed }),
      );

      expect(pull).toBeNull();
      expect(proceed).toHaveBeenCalledWith([]);
      expect(presentationSync.pullPresentations).toHaveBeenCalledTimes(1);
    });

    it("since가 아닌 까닭으로 받지 못하면 받은 시각을 그대로 두고 그 오류를 던진다", async () => {
      presentationSync.pullPresentations.mockRejectedValueOnce(
        new ServerRejectedError(503),
      );

      await expect(pullServerPresentations(USER, options([]))).rejects.toThrow(
        ServerRejectedError,
      );
      await pullServerPresentations(USER, options([]));

      expect(sinceSent()).toBe(
        new Date(NOW - PULL_SINCE_MARGIN_MS).toISOString(),
      );
    });

    it("따로 받기를 실패하면 받기를 실패로 끝낸다", async () => {
      const missing = withId(synced(), "5".repeat(21));
      presentationSync.pullPresentations.mockResolvedValue([headerOf(missing)]);
      presentationSync.pullPresentation.mockRejectedValue(
        new ServerRejectedError(503),
      );

      await expect(pullServerPresentations(USER, options([]))).rejects.toThrow(
        ServerRejectedError,
      );
    });

    it("받은 목록을 보고 멈추라고 하면(proceed) 더 요청하지 않는다", async () => {
      const missing = withId(synced(), "6".repeat(21));
      const header = headerOf(missing);
      presentationSync.pullPresentations.mockResolvedValue([header]);
      const proceed = vi.fn(() => false);

      const pull = await pullServerPresentations(
        USER,
        options([], { proceed }),
      );

      expect(pull).toBeNull();
      expect(proceed).toHaveBeenCalledWith([[header]]);
      expect(presentationSync.pullPresentation).not.toHaveBeenCalled();
    });

    it("따로 받은 문서도 멈출지 묻고, 멈추라고 하면 버린다", async () => {
      const missing = withId(synced(), "7".repeat(21));
      const fetched = serverCopy(missing);
      presentationSync.pullPresentations.mockResolvedValue([headerOf(missing)]);
      presentationSync.pullPresentation.mockResolvedValue(fetched);
      const proceed = vi.fn((lists: readonly (readonly unknown[])[]) =>
        lists.every((list) => !list.includes(fetched)),
      );

      const pull = await pullServerPresentations(
        USER,
        options([], { proceed }),
      );

      expect(pull).toBeNull();
      expect(proceed).toHaveBeenLastCalledWith([[fetched]]);
    });
  });
});
