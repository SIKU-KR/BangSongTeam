import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  API_ERRORS,
  DEFAULT_DECK_STYLE,
  PresentationDocumentSchema,
  laterThan,
  toPresentationChanges,
  type Presentation,
  type PresentationChanges,
  type PresentationDocument,
} from "#shared";
import { ERROR_COPY } from "#copy/common";

const api = vi.hoisted(() => ({
  patch: vi.fn<
    (args: { param: { id: string }; json: PresentationChanges }) => Promise<{
      status: number;
      ok: boolean;
      json: () => Promise<unknown>;
    }>
  >(),
  remove: vi.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => ({ ok: true }),
  })),
  get: vi.fn<
    () => Promise<{
      status: number;
      ok: boolean;
      json: () => Promise<unknown>;
    }>
  >(),
  listDecks: vi.fn<
    () => Promise<{
      status: number;
      ok: boolean;
      json: () => Promise<unknown>;
    }>
  >(),
}));

const requestSessionCheck = vi.hoisted(() => vi.fn<() => void>());

vi.mock("../auth/sessionStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/sessionStore")>()),
  requestSessionCheck,
}));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    api: {
      api: {
        presentations: {
          ":id": { $patch: api.patch, $delete: api.remove, $get: api.get },
        },
        decks: { $get: api.listDecks, ":id": actual.api.api.decks[":id"] },
        folders: actual.api.api.folders,
        "client-reports": { $path: () => "/api/client-reports" },
      },
    },
  };
});

import {
  __resetServerDecksForTests,
  deleteDeckRemote,
  deleteFolderRemote,
  deletePresentationRemote,
  endSharedPresentationRefresh,
  pullDecks,
  pushPresentation,
  refreshSharedPresentation,
  rememberServerDocuments,
  setOwnPresentationListener,
  setSharedPresentationListener,
  syncFailureReasonOf,
  UnsyncableDocumentError,
} from "./presentationSync";
import { getSyncSnapshot, resetSyncStatus, setSyncStatus } from "./syncStatus";
import {
  isRetryableApiError,
  OfflineError,
  ServerRejectedError,
} from "../api/request";
import { __resetLineageForTests } from "./presentationLineage";
import { rememberRequestMeta } from "../api/traceContext";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import {
  __resetClientReportsForTests,
  flushClientReports,
} from "../observability/clientReports";

const USER = "00000000x000000000001";
const DOC_ID = "100000000000000000001";
const FOLDER_ID = "f00000000000000000001";
const MOVED_FOLDER_ID = "f00000000000000000002";

function deckId(n: number): string {
  return `c${String(n).padStart(20, "0")}`;
}

function makeSet(songCount = 3): PresentationDocument {
  return PresentationDocumentSchema.parse({
    id: DOC_ID,
    userId: USER,
    title: "주일 1부 예배",
    serviceDate: "2026-09-27",
    items: Array.from({ length: songCount }, (_, n) => ({
      id: `3${String(n).padStart(20, "0")}`,
      presentationId: DOC_ID,
      deckId: deckId(n),
      order: n,
      deck: {
        id: deckId(n),
        userId: USER,
        scope: "presentation",
        presentationId: DOC_ID,
        title: `곡 ${n}`,
        lyricsRaw: `가사 ${n}`,
        slides: [],
        backgroundId: null,
        style: DEFAULT_DECK_STYLE,
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      },
    })),
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

function withLyrics(
  doc: PresentationDocument,
  index: number,
  lyricsRaw: string,
): PresentationDocument {
  return {
    ...doc,
    items: doc.items.map((item, i) =>
      i === index ? { ...item, deck: { ...item.deck, lyricsRaw } } : item,
    ),
  };
}

function respond(status: number) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => (status === 200 ? { ok: true } : { error: "거절" }),
  };
}

function sentDeckIds(call: number): string[] {
  return api.patch.mock.calls[call][0].json.decks.map((deck) => deck.id);
}

describe("세트 변경분 push", () => {
  beforeEach(() => {
    __resetServerDecksForTests();
    api.patch.mockReset();
    api.patch.mockResolvedValue(respond(200));
  });

  it("처음 올리는 세트는 모든 덱을 보낸다", async () => {
    await pushPresentation(makeSet());

    expect(sentDeckIds(0)).toEqual([deckId(0), deckId(1), deckId(2)]);
  });

  it("올린 뒤에는 바뀐 덱만 보내고 순서 목록은 전부 보낸다", async () => {
    await pushPresentation(makeSet());
    await pushPresentation(withLyrics(makeSet(), 1, "고친 가사"));

    expect(sentDeckIds(1)).toEqual([deckId(1)]);
    expect(api.patch.mock.calls[1][0].json.items).toHaveLength(3);
  });

  it("아무 곡도 바뀌지 않았으면 덱 없이 헤더와 순서만 보낸다", async () => {
    await pushPresentation(makeSet());
    await pushPresentation({ ...makeSet(), title: "새 제목" });

    expect(sentDeckIds(1)).toEqual([]);
    expect(api.patch.mock.calls[1][0].json.title).toBe("새 제목");
  });

  it("부팅 때 받은 서버본을 기준으로 삼는다", async () => {
    rememberServerDocuments([makeSet()]);

    await pushPresentation(withLyrics(makeSet(), 2, "고친 가사"));

    expect(sentDeckIds(0)).toEqual([deckId(2)]);
  });

  it("보기 전용 공유 세트는 기준으로 삼지 않는다", async () => {
    rememberServerDocuments([{ ...makeSet(), access: { ownerName: "A" } }]);

    await pushPresentation(makeSet());

    expect(sentDeckIds(0)).toHaveLength(3);
  });

  it("서버가 모르는 곡이 있다고 하면(409) 모든 덱을 담아 다시 보낸다", async () => {
    rememberServerDocuments([makeSet()]);
    api.patch
      .mockResolvedValueOnce(respond(409))
      .mockResolvedValueOnce(respond(200));

    await pushPresentation(withLyrics(makeSet(), 0, "고친 가사"));

    expect(sentDeckIds(0)).toEqual([deckId(0)]);
    expect(sentDeckIds(1)).toEqual([deckId(0), deckId(1), deckId(2)]);
  });

  it("실패한 push는 기준을 바꾸지 않아 다음에 다시 보낸다", async () => {
    await pushPresentation(makeSet());
    api.patch.mockResolvedValueOnce(respond(500));

    await expect(
      pushPresentation(withLyrics(makeSet(), 0, "고친 가사")),
    ).rejects.toThrow();
    await pushPresentation(withLyrics(makeSet(), 0, "고친 가사"));

    expect(sentDeckIds(2)).toEqual([deckId(0)]);
  });

  it("영구 삭제한 세트는 잊어서 같은 id로 되살리면 모든 덱을 보낸다", async () => {
    await pushPresentation(makeSet());
    await deletePresentationRemote(DOC_ID);

    await pushPresentation(makeSet());

    expect(sentDeckIds(1)).toHaveLength(3);
  });

  it("덱이 빠진 항목이 있는 세트는 보내지 않고 보낼 수 없는 문서라고 알린다", async () => {
    const doc = makeSet();
    const broken = {
      ...doc,
      items: [{ ...doc.items[0], deck: undefined }],
    };

    const err = await pushPresentation(broken).catch((error: unknown) => error);

    expect(err).toBeInstanceOf(UnsyncableDocumentError);
    expect(syncFailureReasonOf(err)).toBe(ERROR_COPY.documentInvalid);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("100자를 넘는 제목은 100자로 줄여 보낸다", async () => {
    await pushPresentation({ ...makeSet(), title: "가".repeat(150) });

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch.mock.calls[0][0].json.title).toBe("가".repeat(100));
  });

  it("곡 제목과 원작자 이름이 한도를 넘으면 줄여 보내고, 줄인 곡을 다음에 다시 보내지 않는다", async () => {
    const doc = makeSet();
    const longSong: PresentationDocument = {
      ...doc,
      items: doc.items.map((item, index) =>
        index === 0
          ? {
              ...item,
              deck: {
                ...item.deck,
                title: "나".repeat(153),
                forkedFromAuthorName: "x".repeat(150),
              },
            }
          : item,
      ),
    };

    await pushPresentation(longSong);
    await pushPresentation(longSong);

    expect(api.patch.mock.calls[0][0].json.decks[0]).toMatchObject({
      title: "나".repeat(100),
      forkedFromAuthorName: "x".repeat(100),
    });
    expect(sentDeckIds(1)).toEqual([]);
  });

  it("한도 안의 세트는 줄이지 않고 그대로 보낸다", async () => {
    await pushPresentation(makeSet());

    expect(api.patch.mock.calls[0][0].json).toEqual(
      toPresentationChanges(makeSet()),
    );
  });
});

function listenerMock() {
  return {
    current: vi.fn<(id: string) => Presentation | undefined>(),
    requeue: vi.fn<(id: string) => void>(),
    saved: vi.fn<(sent: Presentation, stored: string) => void>(),
    rebase: vi.fn<(id: string, base: string) => void>(),
    adopt: vi.fn<(server: Presentation) => void>(),
    conflict: vi.fn<(server: Presentation) => void>(),
    gone: vi.fn<(id: string) => void>(),
  };
}

describe("스토어의 지금 판 올리기", () => {
  const startPath = window.location.pathname;
  const listener = listenerMock();

  beforeEach(() => {
    __resetServerDecksForTests();
    api.patch.mockReset();
    api.patch.mockResolvedValue(respond(200));
    for (const fn of Object.values(listener)) fn.mockReset();
    setOwnPresentationListener(listener);
  });

  afterEach(() => {
    setOwnPresentationListener(null);
    window.history.pushState({}, "", startPath);
  });

  it("큐에 든 사본이 아니라 올리는 순간 스토어에 있는 판을 올린다", async () => {
    const queued = makeSet();
    listener.current.mockReturnValue(
      withLyrics({ ...queued, title: "큐에 넣은 뒤 고친 제목" }, 1, "새 가사"),
    );

    await pushPresentation(queued);

    expect(listener.current).toHaveBeenCalledWith(DOC_ID);
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch.mock.calls[0][0].json.title).toBe(
      "큐에 넣은 뒤 고친 제목",
    );
    expect(
      api.patch.mock.calls[0][0].json.decks.find(
        (deck) => deck.id === deckId(1),
      )?.lyricsRaw,
    ).toBe("새 가사");
  });

  it("그사이 지운 세트와 공유받은 사본이 된 자리는 요청 없이 끝낸다", async () => {
    listener.current.mockReturnValueOnce(undefined);
    await expect(pushPresentation(makeSet())).resolves.toBeUndefined();

    listener.current.mockReturnValueOnce({
      ...makeSet(),
      access: { ownerName: "인도자" },
    });
    await expect(pushPresentation(makeSet())).resolves.toBeUndefined();

    expect(api.patch).not.toHaveBeenCalled();
  });

  it("송출 중에 서버가 모르는 곡이 있다고 하면(409) 모든 덱을 다시 보내지 않고 큐에 다시 넣는다", async () => {
    rememberServerDocuments([makeSet()]);
    const edited = withLyrics(makeSet(), 0, "고친 가사");
    listener.current.mockReturnValue(edited);
    api.patch.mockResolvedValueOnce(respond(409));
    window.history.pushState({}, "", `/present/${DOC_ID}/fullscreen`);

    await pushPresentation(edited);

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(listener.requeue).toHaveBeenCalledExactlyOnceWith(DOC_ID);

    window.history.pushState({}, "", "/presentations");
    await pushPresentation(edited);

    expect(sentDeckIds(1)).toEqual([deckId(0), deckId(1), deckId(2)]);
  });

  it("보내는 동안 계정이 끝나 창구를 떼고 송출을 시작했으면, 409를 받아도 다시 보내지 않고 보낼 때의 창구로 큐에 다시 넣는다", async () => {
    rememberServerDocuments([makeSet()]);
    const edited = withLyrics(makeSet(), 0, "고친 가사");
    listener.current.mockReturnValue(edited);
    let answer: () => void = () => undefined;
    api.patch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = () => resolve(respond(409));
        }),
    );

    const pushing = pushPresentation(edited);
    await vi.waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    window.history.pushState({}, "", `/present/${DOC_ID}/fullscreen`);
    setOwnPresentationListener(null);
    answer();
    await pushing;

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(listener.requeue).toHaveBeenCalledExactlyOnceWith(DOC_ID);
  });

  it("창구 없이 보낸 push는 송출 중에 409를 받으면 다시 보내지 않고 그 거절을 던진다", async () => {
    setOwnPresentationListener(null);
    rememberServerDocuments([makeSet()]);
    api.patch.mockResolvedValueOnce(respond(409));
    window.history.pushState({}, "", `/present/${DOC_ID}/fullscreen`);

    await expect(
      pushPresentation(withLyrics(makeSet(), 0, "고친 가사")),
    ).rejects.toMatchObject({ status: 409 });

    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it("송출 중이 아니면 409 뒤에 모든 덱을 담아 곧바로 다시 보낸다", async () => {
    rememberServerDocuments([makeSet()]);
    const edited = withLyrics(makeSet(), 0, "고친 가사");
    listener.current.mockReturnValue(edited);
    api.patch.mockResolvedValueOnce(respond(409));

    await pushPresentation(edited);

    expect(listener.requeue).not.toHaveBeenCalled();
    expect(sentDeckIds(1)).toEqual([deckId(0), deckId(1), deckId(2)]);
  });

  it("큐가 담긴 폴더를 올린 뒤 다른 폴더로 옮긴 판은 보내지 않고 큐에 다시 넣어, 큐가 옮긴 폴더를 먼저 올리게 한다", async () => {
    const queued = { ...makeSet(), folderId: FOLDER_ID };
    listener.current.mockReturnValue({ ...queued, folderId: MOVED_FOLDER_ID });

    await pushPresentation(queued);

    expect(api.patch).not.toHaveBeenCalled();
    expect(listener.requeue).toHaveBeenCalledExactlyOnceWith(DOC_ID);
  });

  it("폴더 밖으로만 옮겨도 큐에 다시 넣고, 폴더가 그대로면 곧바로 보낸다", async () => {
    const queued = { ...makeSet(), folderId: FOLDER_ID };
    listener.current
      .mockReturnValueOnce({ ...queued, folderId: null })
      .mockReturnValueOnce({ ...queued, title: "폴더는 그대로인 판" });

    await pushPresentation(queued);
    await pushPresentation(queued);

    expect(listener.requeue).toHaveBeenCalledExactlyOnceWith(DOC_ID);
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch.mock.calls[0][0].json).toMatchObject({
      title: "폴더는 그대로인 판",
      folderId: FOLDER_ID,
    });
  });
});

describe("기준 판과 서버의 거절 (412·410)", () => {
  const startPath = window.location.pathname;
  const B = "2026-09-21T00:00:00.000Z";
  const B1 = "2026-09-21T00:00:00.001Z";
  const EDITED_AT = "2026-09-21T00:01:00.000Z";
  const S = "2026-09-21T00:05:00.000Z";
  const S2 = "2026-09-21T00:06:00.000Z";
  const S3 = "2026-09-21T00:07:00.000Z";
  const listener = listenerMock();
  let current: Presentation | undefined;

  function respondWith(status: number, body: unknown) {
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    };
  }

  function storedAt(updatedAt: string) {
    return respondWith(200, { ok: true, updatedAt });
  }

  function conflictWith(server: Presentation) {
    return respondWith(412, {
      error: API_ERRORS.presentation.conflict,
      presentation: server,
    });
  }

  function dirty(changes: Partial<Presentation> = {}): Presentation {
    return { ...makeSet(), baseUpdatedAt: B, updatedAt: B1, ...changes };
  }

  function serverCopy(changes: Partial<Presentation>): Presentation {
    return { ...makeSet(), ...changes };
  }

  async function loseResponseOf(sent: Presentation): Promise<void> {
    api.patch.mockRejectedValueOnce(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    await expect(pushPresentation(sent)).rejects.toBeInstanceOf(OfflineError);
  }

  beforeEach(() => {
    __resetServerDecksForTests();
    __resetLineageForTests();
    api.patch.mockReset();
    for (const fn of Object.values(listener)) fn.mockReset();
    current = dirty();
    listener.current.mockImplementation((id) =>
      current?.id === id ? current : undefined,
    );
    listener.rebase.mockImplementation((id, base) => {
      if (current?.id !== id) return;
      current = {
        ...current,
        baseUpdatedAt: base,
        updatedAt: laterThan(base, current.updatedAt),
      };
    });
    setOwnPresentationListener(listener);
  });

  afterEach(() => {
    setOwnPresentationListener(null);
    window.history.pushState({}, "", startPath);
  });

  it("기준 판을 실어 보내고, 서버와 맞춘 판은 요청 없이 끝낸다", async () => {
    api.patch.mockResolvedValue(storedAt(S));

    await pushPresentation(current!);
    current = dirty({ updatedAt: B });
    await pushPresentation(current);

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch.mock.calls[0][0].json.baseUpdatedAt).toBe(B);
  });

  it("200이면 보낸 판을 서버가 남긴 판으로 확정하고, 판을 주지 않는 서버면 보낸 시각으로 확정한다", async () => {
    const sent = current!;
    api.patch
      .mockResolvedValueOnce(storedAt(S))
      .mockResolvedValueOnce(respondWith(200, { ok: true }))
      .mockResolvedValueOnce(storedAt("어제"));

    await pushPresentation(sent);
    await pushPresentation(sent);
    await pushPresentation(sent);

    expect(listener.saved.mock.calls).toEqual([
      [sent, S],
      [sent, sent.updatedAt],
      [sent, sent.updatedAt],
    ]);
    expect(listener.saved.mock.calls[0][0]).toBe(sent);
  });

  it("두 기기가 같은 기준 판에서 같은 시각을 찍었어도 내용이 다르면 엇갈린 판으로 보고, 같으면 맞춘 판으로 본다", async () => {
    current = dirty({ title: "이 기기의 제목" });
    api.patch
      .mockResolvedValueOnce(
        conflictWith(serverCopy({ title: "다른 기기의 제목", updatedAt: B1 })),
      )
      .mockResolvedValueOnce(
        conflictWith(serverCopy({ title: "이 기기의 제목", updatedAt: B1 })),
      );

    await pushPresentation(current);
    expect(listener.conflict).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: "다른 기기의 제목", updatedAt: B1 }),
    );
    expect(listener.saved).not.toHaveBeenCalled();

    await pushPresentation(current);
    expect(listener.saved).toHaveBeenCalledExactlyOnceWith(current, B1);
    expect(listener.conflict).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledTimes(2);
  });

  it("응답을 잃은 저장 뒤 고친 판은 412의 서버 판이 그 저장이면 기준 판을 옮겨 다시 보내고 사본을 만들지 않는다", async () => {
    const lost = dirty({ title: "응답을 잃은 판" });
    current = lost;
    await loseResponseOf(lost);
    current = { ...lost, title: "그 뒤에 고친 판", updatedAt: EDITED_AT };
    api.patch
      .mockResolvedValueOnce(conflictWith({ ...lost, updatedAt: S }))
      .mockResolvedValueOnce(storedAt(S2));

    await pushPresentation(current);

    expect(listener.rebase).toHaveBeenCalledExactlyOnceWith(DOC_ID, S);
    expect(api.patch).toHaveBeenCalledTimes(3);
    expect(api.patch.mock.calls[2][0].json).toMatchObject({
      title: "그 뒤에 고친 판",
      baseUpdatedAt: S,
    });
    expect(listener.saved).toHaveBeenCalledExactlyOnceWith(current, S2);
    expect(listener.conflict).not.toHaveBeenCalled();
    expect(listener.adopt).not.toHaveBeenCalled();
  });

  it("다시 보내도 잇달아 412면 기준 판은 두 번까지만 옮기고 세 번째는 실패로 남긴다", async () => {
    const lost = dirty({ title: "응답을 잃은 판" });
    current = lost;
    await loseResponseOf(lost);
    current = { ...lost, title: "그 뒤에 고친 판", updatedAt: EDITED_AT };
    api.patch
      .mockResolvedValueOnce(conflictWith({ ...lost, updatedAt: S }))
      .mockResolvedValueOnce(conflictWith({ ...lost, updatedAt: S2 }))
      .mockResolvedValueOnce(conflictWith({ ...lost, updatedAt: S3 }));

    const err = await pushPresentation(current).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServerRejectedError);
    expect((err as ServerRejectedError).status).toBe(412);
    expect(isRetryableApiError(err)).toBe(false);
    expect(listener.rebase).toHaveBeenCalledTimes(2);
    expect(api.patch).toHaveBeenCalledTimes(4);
  });

  it("기준 판을 옮기지 못했으면(그사이 지웠거나 취소한 push) 다시 보내지 않는다", async () => {
    const lost = dirty({ title: "응답을 잃은 판" });
    current = lost;
    await loseResponseOf(lost);
    current = { ...lost, title: "그 뒤에 고친 판", updatedAt: EDITED_AT };
    listener.rebase.mockImplementation(() => undefined);
    api.patch.mockResolvedValueOnce(conflictWith({ ...lost, updatedAt: S }));

    await expect(pushPresentation(current)).resolves.toBeUndefined();

    expect(listener.rebase).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledTimes(2);
  });

  it("다시 얹는 사이 다른 폴더로 옮긴 판은 다시 보내지 않고 큐에 다시 넣는다", async () => {
    const lost = dirty({ title: "응답을 잃은 판", folderId: FOLDER_ID });
    current = lost;
    await loseResponseOf(lost);
    current = { ...lost, title: "그 뒤에 고친 판", updatedAt: EDITED_AT };
    const queued = current;
    api.patch.mockResolvedValueOnce(conflictWith({ ...lost, updatedAt: S }));
    listener.rebase.mockImplementation((_id, base) => {
      current = {
        ...queued,
        folderId: MOVED_FOLDER_ID,
        baseUpdatedAt: base,
        updatedAt: laterThan(base, queued.updatedAt),
      };
    });

    await pushPresentation(queued);

    expect(listener.rebase).toHaveBeenCalledExactlyOnceWith(DOC_ID, S);
    expect(listener.requeue).toHaveBeenCalledExactlyOnceWith(DOC_ID);
    expect(api.patch).toHaveBeenCalledTimes(2);
  });

  it("송출 중에는 이 탭이 앞선 판도 다시 보내지 않고 큐에 다시 넣는다", async () => {
    const lost = dirty({ title: "응답을 잃은 판" });
    current = lost;
    await loseResponseOf(lost);
    current = { ...lost, title: "그 뒤에 고친 판", updatedAt: EDITED_AT };
    api.patch.mockResolvedValueOnce(conflictWith({ ...lost, updatedAt: S }));
    window.history.pushState({}, "", `/present/${DOC_ID}/fullscreen`);

    await pushPresentation(current);

    expect(listener.requeue).toHaveBeenCalledExactlyOnceWith(DOC_ID);
    expect(listener.rebase).not.toHaveBeenCalled();
    expect(api.patch).toHaveBeenCalledTimes(2);
  });

  it("고친 것이 없는 판이 보내는 사이 서버보다 뒤처졌으면 서버 판을 받는다", async () => {
    const sent = current!;
    const server = serverCopy({ title: "다른 기기의 제목", updatedAt: S });
    listener.current
      .mockReturnValueOnce(sent)
      .mockReturnValueOnce(dirty({ updatedAt: B }));
    api.patch.mockResolvedValueOnce(conflictWith(server));

    await pushPresentation(sent);

    expect(listener.adopt).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: "다른 기기의 제목", updatedAt: S }),
    );
  });

  it("이 탭이 이미 더 새 판을 받았으면 늦게 온 412로 아무것도 바꾸지 않는다", async () => {
    current = dirty({ baseUpdatedAt: S, updatedAt: S2 });
    api.patch.mockResolvedValueOnce(
      conflictWith(serverCopy({ title: "옛 서버 판", updatedAt: B1 })),
    );

    await expect(pushPresentation(current)).resolves.toBeUndefined();

    for (const outcome of [
      listener.saved,
      listener.rebase,
      listener.adopt,
      listener.conflict,
      listener.gone,
    ]) {
      expect(outcome).not.toHaveBeenCalled();
    }
  });

  it("올려 확정한 판보다 먼저 받은 서버 목록으로는 덱 기준을 되돌리지 않고, 더 새 서버 목록으로는 바꾼다", async () => {
    const original = makeSet();
    const fromOtherDevice = withLyrics(original, 1, "다른 기기에서 고친 가사");
    rememberServerDocuments([original]);
    api.patch
      .mockResolvedValueOnce(storedAt(S))
      .mockResolvedValueOnce(storedAt(S2))
      .mockResolvedValueOnce(storedAt(laterThan(S3, S3)));

    current = {
      ...withLyrics(original, 0, "고친 가사"),
      baseUpdatedAt: B,
      updatedAt: B1,
    };
    await pushPresentation(current);
    rememberServerDocuments([original]);
    current = { ...original, baseUpdatedAt: S, updatedAt: laterThan(S, S) };
    await pushPresentation(current);
    rememberServerDocuments([{ ...fromOtherDevice, updatedAt: S3 }]);
    current = {
      ...fromOtherDevice,
      title: "새 제목",
      baseUpdatedAt: S3,
      updatedAt: laterThan(S3, S3),
    };
    await pushPresentation(current);

    expect(sentDeckIds(0)).toEqual([deckId(0)]);
    expect(sentDeckIds(1)).toEqual([deckId(0)]);
    expect(sentDeckIds(2)).toEqual([]);
  });

  it("모든 곡을 다시 보낸 뒤 받은 412도 견준다", async () => {
    rememberServerDocuments([makeSet()]);
    current = dirty({ title: "이 기기의 제목" });
    api.patch
      .mockResolvedValueOnce(respond(409))
      .mockResolvedValueOnce(
        conflictWith(serverCopy({ title: "다른 기기의 제목", updatedAt: S })),
      );

    await pushPresentation(current);

    expect(sentDeckIds(1)).toHaveLength(3);
    expect(listener.conflict).toHaveBeenCalledTimes(1);
  });

  it("영구 삭제한 세트라는 답(410)을 받으면 알리고 기억한 덱을 잊는다", async () => {
    rememberServerDocuments([makeSet()]);
    api.patch
      .mockResolvedValueOnce(
        respondWith(410, { error: API_ERRORS.presentation.deleted }),
      )
      .mockResolvedValueOnce(storedAt(S));

    await expect(pushPresentation(current!)).resolves.toBeUndefined();
    expect(listener.gone).toHaveBeenCalledExactlyOnceWith(DOC_ID);

    await pushPresentation(current!);
    expect(sentDeckIds(0)).toEqual([]);
    expect(sentDeckIds(1)).toHaveLength(3);
  });

  it("412의 서버 판을 읽을 수 없으면 다시 시도하지 않는 실패로 남긴다", async () => {
    api.patch.mockResolvedValueOnce(
      respondWith(412, {
        error: API_ERRORS.presentation.conflict,
        presentation: { id: DOC_ID, title: 42 },
      }),
    );

    const err = await pushPresentation(current!).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServerRejectedError);
    expect((err as ServerRejectedError).status).toBe(412);
    expect(isRetryableApiError(err)).toBe(false);
    expect(listener.conflict).not.toHaveBeenCalled();
  });
});

describe("세션 확인 요청", () => {
  beforeEach(() => {
    __resetServerDecksForTests();
    api.patch.mockReset();
    requestSessionCheck.mockClear();
  });

  it.each([401, 403])(
    "올리기가 %i로 거절되면 세션을 한 번 확인한다",
    async (status) => {
      api.patch.mockResolvedValueOnce(respond(status));

      await expect(pushPresentation(makeSet())).rejects.toThrow();

      expect(requestSessionCheck).toHaveBeenCalledTimes(1);
    },
  );

  it.each([404, 503])(
    "올리기가 %i로 거절되면 세션을 확인하지 않는다",
    async (status) => {
      api.patch.mockResolvedValueOnce(respond(status));

      await expect(pushPresentation(makeSet())).rejects.toThrow();

      expect(requestSessionCheck).not.toHaveBeenCalled();
    },
  );

  it("서버에 닿지 못하면 세션을 확인하지 않는다", async () => {
    api.patch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(pushPresentation(makeSet())).rejects.toBeInstanceOf(
      OfflineError,
    );

    expect(requestSessionCheck).not.toHaveBeenCalled();
  });
});

describe("동기화 실패 이유", () => {
  it("서버가 거절한 문장과 보낼 수 없는 문서만 이유로 보여 준다", () => {
    expect(
      syncFailureReasonOf(
        new ServerRejectedError(413, API_ERRORS.presentation.tooLarge),
      ),
    ).toBe(API_ERRORS.presentation.tooLarge);
    expect(syncFailureReasonOf(new UnsyncableDocumentError())).toBe(
      ERROR_COPY.documentInvalid,
    );
    expect(syncFailureReasonOf(new OfflineError())).toBeUndefined();
    expect(
      syncFailureReasonOf(new Error("Unexpected token <")),
    ).toBeUndefined();
  });
});

describe("동기화 실패 보고", () => {
  const ROUTE = "/api/presentations/:id";
  const sendBeacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);

  async function flushedReports(): Promise<unknown[]> {
    flushClientReports();
    const blob = sendBeacon.mock.calls.at(-1)?.[1];
    if (!blob) return [];
    return (JSON.parse(await blob.text()) as { reports: unknown[] }).reports;
  }

  beforeEach(() => {
    __resetServerDecksForTests();
    __resetClientReportsForTests();
    sendBeacon.mockClear();
    Object.defineProperty(navigator, "sendBeacon", {
      value: sendBeacon,
      configurable: true,
    });
    api.patch.mockReset();
  });

  it("5xx는 상관 ID와 경로 패턴으로 보고에 담는다", async () => {
    const response = respond(503);
    rememberRequestMeta(response, { requestId: "a".repeat(32), route: ROUTE });
    api.patch.mockResolvedValueOnce(response);

    await expect(pushPresentation(makeSet())).rejects.toThrow();

    expect(await flushedReports()).toEqual([
      expect.objectContaining({
        kind: "server_error",
        route: ROUTE,
        requestId: "a".repeat(32),
      }),
    ]);
  });

  it("서버에 닿지 못한 요청도 담고, 다시 보내면 되는 409는 담지 않는다", async () => {
    const network = new TypeError("Failed to fetch");
    rememberRequestMeta(network, { requestId: "b".repeat(32), route: ROUTE });
    api.patch
      .mockResolvedValueOnce(respond(409))
      .mockResolvedValueOnce(respond(200))
      .mockRejectedValueOnce(network);

    await pushPresentation(makeSet());
    await expect(pushPresentation(makeSet())).rejects.toThrow();

    expect(await flushedReports()).toEqual([
      expect.objectContaining({ kind: "unreachable", route: ROUTE }),
    ]);
  });
});

describe("보관함 곡 받기", () => {
  const DELETED = "c000000000000000000d1";
  const libraryDeck = {
    id: deckId(1),
    userId: USER,
    scope: "library",
    title: "곡",
    lyricsRaw: "가사",
    slides: [],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  };

  function respondWith(body: unknown) {
    return { status: 200, ok: true, json: async () => body };
  }

  beforeEach(() => {
    api.listDecks.mockReset();
  });

  it("지운 곡 목록을 보내지 않는 서버의 응답은 지운 곡이 없는 것으로 읽는다", async () => {
    api.listDecks.mockResolvedValueOnce(respondWith({ decks: [libraryDeck] }));

    await expect(pullDecks()).resolves.toEqual({
      decks: [libraryDeck],
      deletedIds: [],
    });
  });

  it("지운 곡 목록에서 id 형식이 아닌 값은 버린다", async () => {
    api.listDecks.mockResolvedValueOnce(
      respondWith({ decks: [], deletedIds: [DELETED, "짧은 id", 42, null] }),
    );

    await expect(pullDecks()).resolves.toEqual({
      decks: [],
      deletedIds: [DELETED],
    });
  });

  it("지운 곡 목록이 배열이 아니면 지운 곡이 없는 것으로 읽는다", async () => {
    api.listDecks.mockResolvedValueOnce(
      respondWith({ decks: [], deletedIds: DELETED }),
    );

    await expect(pullDecks()).resolves.toEqual({ decks: [], deletedIds: [] });
  });
});

describe("프레젠테이션 원격 삭제", () => {
  beforeEach(() => {
    resetSyncStatus();
  });

  it("이미 없는 프레젠테이션(404)은 성공으로 보고 동기화 실패를 띄우지 않는다", async () => {
    api.remove.mockResolvedValueOnce({
      status: 404,
      ok: false,
      json: async () => ({ ok: false }),
    });

    await expect(deletePresentationRemote(DOC_ID)).resolves.toBeUndefined();

    expect(getSyncSnapshot().status).toBe("idle");
  });
});

describe("보관함 곡 원격 삭제", () => {
  const SONG = deckId(7);
  let fake: FakeApi | null = null;

  afterEach(() => {
    fake?.restore();
    fake = null;
  });

  it("서버가 지운 곡으로 기록하면(200) true를 돌려준다", async () => {
    fake = installFakeApi({
      "DELETE /api/decks/*": () => ({ body: { ok: true } }),
    });

    await expect(deleteDeckRemote(SONG)).resolves.toBe(true);
    expect(fake.calls).toMatchObject([
      { method: "DELETE", path: `/api/decks/${SONG}` },
    ]);
  });

  it("이 계정의 곡이 아니라고 하면(404) 실패로 던지지 않고 false를 돌려준다", async () => {
    fake = installFakeApi({
      "DELETE /api/decks/*": () => ({
        status: 404,
        body: { error: API_ERRORS.deck.notAccessible },
      }),
    });

    await expect(deleteDeckRemote(SONG)).resolves.toBe(false);
  });

  it("그 밖의 거절은 그대로 던진다", async () => {
    fake = installFakeApi({
      "DELETE /api/decks/*": () => ({
        status: 503,
        body: { error: API_ERRORS.serverBusy },
      }),
    });

    await expect(deleteDeckRemote(SONG)).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("폴더 원격 영구 삭제", () => {
  const FOLDER = "a00000000000000000001";
  const CHILD = "b00000000000000000002";
  const IMPORTED = "550e8400-e29b-41d4-a716-446655440000";
  const expected = {
    folderIds: [FOLDER, CHILD],
    presentationIds: [DOC_ID, IMPORTED],
  };
  let fake: FakeApi | null = null;

  afterEach(() => {
    fake?.restore();
    fake = null;
  });

  it("이 기기가 본 하위 폴더·프레젠테이션 id를 본문에 담아 보낸다", async () => {
    fake = installFakeApi({
      "DELETE /api/folders/*": () => ({
        body: {
          ok: true,
          deletedFolderIds: [FOLDER, CHILD],
          deletedPresentationIds: [DOC_ID],
        },
      }),
    });

    await expect(deleteFolderRemote(FOLDER, expected)).resolves.toEqual({
      ok: true,
      deletedFolderIds: [FOLDER, CHILD],
      deletedPresentationIds: [DOC_ID],
    });

    expect(fake.calls).toEqual([
      {
        method: "DELETE",
        path: `/api/folders/${FOLDER}`,
        search: "",
        body: { expected },
      },
    ]);
  });

  it("이미 없는 폴더(404)는 지운 것이 없는 성공으로 본다", async () => {
    fake = installFakeApi({
      "DELETE /api/folders/*": () => ({
        status: 404,
        body: { error: API_ERRORS.folder.notAccessible },
      }),
    });

    await expect(deleteFolderRemote(FOLDER, expected)).resolves.toEqual({
      ok: true,
      deletedFolderIds: [],
      deletedPresentationIds: [],
    });
  });

  it("서버가 지웠다고 돌려준 id가 id 형식이 아니어도 삭제를 끝낸 것으로 본다", async () => {
    fake = installFakeApi({
      "DELETE /api/folders/*": () => ({
        body: {
          ok: true,
          deletedFolderIds: [FOLDER],
          deletedPresentationIds: [IMPORTED],
        },
      }),
    });

    await expect(deleteFolderRemote(FOLDER, expected)).resolves.toEqual({
      ok: true,
      deletedFolderIds: [FOLDER],
      deletedPresentationIds: [IMPORTED],
    });
  });

  it("서버가 그사이 바뀌었다고 거절하면(409) 그 문장을 담아 던진다", async () => {
    fake = installFakeApi({
      "DELETE /api/folders/*": () => ({
        status: 409,
        body: { error: API_ERRORS.trashChanged },
      }),
    });

    const error = await deleteFolderRemote(FOLDER, expected).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(ServerRejectedError);
    expect(error).toMatchObject({
      status: 409,
      message: API_ERRORS.trashChanged,
    });
  });
});

describe("공유받은 프레젠테이션 새로고침 상태", () => {
  beforeEach(() => {
    resetSyncStatus();
    endSharedPresentationRefresh();
    api.get.mockReset();
  });

  it("서버가 잠시 응답하지 못하면(503) 실패가 아니라 오프라인으로 본다", async () => {
    api.get.mockResolvedValueOnce({
      status: 503,
      ok: false,
      json: async () => ({}),
    });

    await expect(refreshSharedPresentation(DOC_ID)).rejects.toThrow();

    expect(getSyncSnapshot().status).toBe("offline");
  });

  it("서버가 새로고침을 거절하면 그 요청의 상관 ID를 문의 코드로 남긴다", async () => {
    const requestId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const response = { status: 403, ok: false, json: async () => ({}) };
    rememberRequestMeta(response, {
      requestId,
      route: "/api/presentations/:id",
    });
    api.get.mockResolvedValueOnce(response);

    await expect(refreshSharedPresentation(DOC_ID)).rejects.toThrow();

    expect(getSyncSnapshot()).toMatchObject({
      status: "error",
      failureRequestId: requestId,
    });
  });

  it("공유 화면을 떠나면 새로고침 실패가 내 프레젠테이션 동기화 표시에 남지 않는다", async () => {
    api.get.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await refreshSharedPresentation(DOC_ID);
    setSyncStatus("presentation", "synced");
    expect(getSyncSnapshot().status).toBe("offline");

    endSharedPresentationRefresh();

    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("화면을 떠난 뒤 도착한 새로고침 결과는 상태를 남기지 않는다", async () => {
    let fail: (err: Error) => void = () => undefined;
    api.get.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const refreshing = refreshSharedPresentation(DOC_ID);
    endSharedPresentationRefresh();
    setSyncStatus("presentation", "synced");

    fail(new TypeError("Failed to fetch"));
    await refreshing;

    expect(getSyncSnapshot().status).toBe("synced");
  });
});

describe("공유받은 프레젠테이션 새로고침 결과", () => {
  const startPath = window.location.pathname;
  const PROJECTION_PATH = `/present/${DOC_ID}/fullscreen`;
  const listener = {
    replaced: vi.fn<(document: PresentationDocument) => void>(),
    lost: vi.fn<(id: string) => void>(),
  };

  beforeEach(() => {
    resetSyncStatus();
    endSharedPresentationRefresh();
    api.get.mockReset();
    listener.replaced.mockReset();
    listener.lost.mockReset();
    setSharedPresentationListener(listener);
  });

  afterEach(() => {
    setSharedPresentationListener(null);
    window.history.pushState({}, "", startPath);
  });

  function holdGet(): (status: number) => void {
    let answer: (status: number) => void = () => undefined;
    api.get.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = (status) =>
          resolve({
            status,
            ok: status < 400,
            json: async () =>
              status < 400 ? { presentation: makeSet() } : { error: "없음" },
          });
      }),
    );
    return answer;
  }

  it("서버가 더는 열 수 없다고 하면(404) 접근을 잃었다고 알리고 실패로 남기지 않는다", async () => {
    api.get.mockResolvedValueOnce({
      status: 404,
      ok: false,
      json: async () => ({ error: API_ERRORS.presentation.notAccessible }),
    });

    await expect(refreshSharedPresentation(DOC_ID)).resolves.toBeUndefined();

    expect(listener.lost).toHaveBeenCalledExactlyOnceWith(DOC_ID);
    expect(listener.replaced).not.toHaveBeenCalled();
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it.each([401, 403, 503])(
    "서버가 %i로 답하면 접근을 잃은 것으로 보지 않아 받아 둔 사본을 지우지 않는다",
    async (status) => {
      api.get.mockResolvedValueOnce({
        status,
        ok: false,
        json: async () => ({}),
      });

      await expect(refreshSharedPresentation(DOC_ID)).rejects.toThrow();

      expect(listener.lost).not.toHaveBeenCalled();
      expect(listener.replaced).not.toHaveBeenCalled();
    },
  );

  it("서버에 닿지 못해도 받아 둔 사본을 지우지 않는다", async () => {
    api.get.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(refreshSharedPresentation(DOC_ID)).resolves.toBeUndefined();

    expect(listener.lost).not.toHaveBeenCalled();
    expect(listener.replaced).not.toHaveBeenCalled();
    expect(getSyncSnapshot().status).toBe("offline");
  });

  it("최신본을 받으면 그 판으로 바꾸라고 알린다", async () => {
    const latest = { ...makeSet(), title: "소유자가 바꾼 제목" };
    api.get.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ presentation: latest }),
    });

    await refreshSharedPresentation(DOC_ID);

    expect(listener.replaced).toHaveBeenCalledExactlyOnceWith(
      PresentationDocumentSchema.parse(latest),
    );
    expect(listener.lost).not.toHaveBeenCalled();
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("받은 최신본을 반영하고, 접근을 잃었으면 알린다", async () => {
    api.get.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ presentation: makeSet() }),
    });
    await refreshSharedPresentation(DOC_ID);
    api.get.mockResolvedValueOnce({
      status: 404,
      ok: false,
      json: async () => ({ error: "없음" }),
    });
    await refreshSharedPresentation(DOC_ID);

    expect(listener.replaced).toHaveBeenCalledExactlyOnceWith(makeSet());
    expect(listener.lost).toHaveBeenCalledExactlyOnceWith(DOC_ID);
  });

  it.each([
    [200, "최신본"],
    [404, "접근을 잃은 것"],
  ])(
    "받는 사이 송출을 시작했으면 %s 응답(%s)을 반영하지 않는다",
    async (status) => {
      const answer = holdGet();
      const refreshing = refreshSharedPresentation(DOC_ID);
      window.history.pushState({}, "", PROJECTION_PATH);

      answer(status);
      await refreshing;

      expect(listener.replaced).not.toHaveBeenCalled();
      expect(listener.lost).not.toHaveBeenCalled();
    },
  );

  it("화면을 떠난 뒤 도착한 응답은 반영하지 않는다", async () => {
    const answer = holdGet();
    const refreshing = refreshSharedPresentation(DOC_ID);
    endSharedPresentationRefresh();

    answer(404);
    await refreshing;

    expect(listener.lost).not.toHaveBeenCalled();
  });
});
