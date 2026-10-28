import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  API_ERRORS,
  DEFAULT_DECK_STYLE,
  PresentationDocumentSchema,
  toPresentationChanges,
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

vi.mock("../api/client", () => ({
  api: {
    api: {
      presentations: {
        ":id": { $patch: api.patch, $delete: api.remove, $get: api.get },
      },
      decks: { $get: api.listDecks },
      "client-reports": { $path: () => "/api/client-reports" },
    },
  },
}));

import {
  __resetServerDecksForTests,
  deletePresentationRemote,
  endSharedPresentationRefresh,
  pullDecks,
  pushPresentation,
  refreshSharedPresentation,
  rememberServerDocuments,
  syncFailureReasonOf,
  UnsyncableDocumentError,
} from "./presentationSync";
import { getSyncSnapshot, resetSyncStatus, setSyncStatus } from "./syncStatus";
import { OfflineError, ServerRejectedError } from "../api/request";
import { rememberRequestMeta } from "../api/traceContext";
import {
  __resetClientReportsForTests,
  flushClientReports,
} from "../observability/clientReports";

const USER = "00000000x000000000001";
const DOC_ID = "100000000000000000001";

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
