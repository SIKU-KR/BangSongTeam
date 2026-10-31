import React from "react";
import { signInAsTestUser } from "../../test/sessionFixture";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { onlineManager, type QueryClient } from "@tanstack/react-query";
import {
  API_ERRORS,
  type Deck,
  DEFAULT_DECK_STYLE,
  MAX_DECK_ARTIST_LENGTH,
  MAX_DECK_TITLE_LENGTH,
  MAX_LYRICS_LENGTH,
  MAX_SEARCH_QUERY_LENGTH,
  OFFICIAL_LIBRARY_NAME,
  clampSearchQuery,
} from "#shared";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../../lib/storage/db";
import {
  createTestQueryClient,
  withQueryClient,
} from "../../test/queryClientFixture";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { SongPickerModal } from "./SongPickerModal";
import {
  getUserSongs,
  resetSongLibraryStore,
  saveSongToLibrary,
  upsertLibraryDeck,
} from "./songLibraryStore";
import {
  __resetDeckSyncForTests,
  flushDeckSync,
  setDeckSyncEnabled,
} from "../../lib/sync/deckSync";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY, ERROR_COPY } from "#copy/common";
import { SEED_USER_ID } from "../../test/presentationFixture";

const SHARED_ID = "c00000005000000000001";
const LYRIC_MATCH_ID = "c00000005000000000002";
const FORK_ID = "c000000050000000000f0";
const NOW = "2026-09-23T00:00:00.000Z";

const SHARED_LYRICS =
  "당신은 시간을 뚫고\n이 땅 가운데 오셨네\n\n우리 없는 하늘을 원치 않아\n우리 삶에 오셨네";

const sharedSummary = {
  id: SHARED_ID,
  title: "시간을 뚫고",
  artist: "WELOVE",
  authorName: "김찬양",
  forkedFromAuthorName: null,
  forkCount: 42,
  backgroundId: null,
  firstSlidePreview: ["당신은 시간을 뚫고", "이 땅 가운데 오셨네"],
  slideCount: 2,
  updatedAt: NOW,
};

function forkedDeck(): Deck {
  return {
    id: FORK_ID,
    userId: SEED_USER_ID,
    scope: "library",
    presentationId: null,
    title: "시간을 뚫고",
    artist: "WELOVE",
    lyricsRaw: SHARED_LYRICS,
    slides: [
      {
        id: "s1",
        order: 0,
        lines: ["당신은 시간을 뚫고", "이 땅 가운데 오셨네"],
      },
      {
        id: "s2",
        order: 1,
        lines: ["우리 없는 하늘을 원치 않아", "우리 삶에 오셨네"],
      },
    ],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    visibility: "private",
    forkedFrom: SHARED_ID,
    forkedFromAuthorName: "김찬양",
    forkCount: 0,
    origin: "fork",
    publishedAt: null,
    takedownAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("SongPickerModal", () => {
  const onSelectSongMock = vi.fn();
  const onCloseMock = vi.fn();
  let api: FakeApi;

  function installServer(
    options: { offline?: boolean; sharedDecks?: (typeof sharedSummary)[] } = {},
  ) {
    const list = options.sharedDecks ?? [sharedSummary];
    api = installFakeApi(
      {
        "GET /api/catalog/search": ({ url }) => {
          const q = url.searchParams.get("q") ?? "";
          const match = (text: string) => !q || text.includes(q);
          return {
            body: {
              decks: match("시간을 뚫고 당신은 우리 없는 하늘을") ? list : [],
            },
          };
        },
        "GET /api/catalog/decks/*": () => ({
          body: {
            deck: {
              ...sharedSummary,
              lyricsRaw: SHARED_LYRICS,
              slides: forkedDeck().slides,
              style: DEFAULT_DECK_STYLE,
            },
          },
        }),
        "POST /api/decks/*/fork": () => ({
          body: { deck: forkedDeck(), alreadyOwned: false },
        }),
        "POST /api/reports": () => ({
          status: 201,
          body: { id: "e00000005000000000001" },
        }),
        "GET /api/lyrics/search": ({ url }) => ({
          body: {
            candidates:
              url.searchParams.get("title") === "은혜 위에 은혜"
                ? [
                    {
                      title: "은혜 위에 은혜",
                      artist: "해준",
                      ids: ["2716460", "2716461"],
                    },
                  ]
                : [],
          },
        }),
        "GET /api/lyrics/song": ({ url }) =>
          url.searchParams.get("ids") === "2716460,2716461"
            ? {
                body: {
                  title: "은혜 위에 은혜",
                  artist: "해준",
                  lyrics: "어두워진 나의 눈\n바라 볼 수 없네\n은혜 위에 은혜",
                },
              }
            : { status: 404, body: { error: API_ERRORS.lyrics.empty } },
      },
      options,
    );
  }

  function renderPicker() {
    return render(
      withQueryClient(
        <SongPickerModal
          isOpen={true}
          onClose={onCloseMock}
          onSelectSong={onSelectSongMock}
        />,
      ),
    );
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    closeOfflineDB();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    signInAsTestUser();
    await resetSongLibraryStore();
    installServer();
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    api.restore();
    __resetDeckSyncForTests();
    closeOfflineDB();
  });

  function seedMySong(title = "내가 만든 찬양") {
    return saveSongToLibrary({
      title,
      artist: "본인",
      lyricsRaw: "첫째 줄\n둘째 줄\n\n셋째 줄\n넷째 줄",
    });
  }

  it("isOpen=false 일 때는 아무것도 렌더링하지 않는다", () => {
    const { container } = render(
      withQueryClient(
        <SongPickerModal
          isOpen={false}
          onClose={onCloseMock}
          onSelectSong={onSelectSongMock}
        />,
      ),
    );
    expect(container.firstChild).toBeNull();
  });

  it("내 곡과 서버의 공유 곡을 함께 보여 준다", async () => {
    seedMySong();
    renderPicker();

    expect(screen.getByText(EDITOR_COPY.song.addSong)).toBeInTheDocument();
    expect(screen.getAllByText("내가 만든 찬양").length).toBeGreaterThan(0);
    expect(
      await screen.findByTestId(`song-item-${SHARED_ID}`),
    ).toBeInTheDocument();
    expect(screen.getByText("42회 가져감")).toBeInTheDocument();
    expect(
      screen.queryByTestId("song-picker-filter-catalog"),
    ).not.toBeInTheDocument();
    expect(api.calls.some((c) => c.path === "/api/catalog/search")).toBe(true);
  });

  it("검색어를 서버 검색과 내 곡 필터에 함께 쓴다", async () => {
    seedMySong("소원");
    renderPicker();
    fireEvent.change(screen.getByTestId("song-picker-search-input"), {
      target: { value: "시간" },
    });

    await waitFor(() =>
      expect(
        api.calls.some((c) => c.search.includes(encodeURIComponent("시간"))),
      ).toBe(true),
    );
    expect(
      await screen.findByTestId(`song-item-${SHARED_ID}`),
    ).toBeInTheDocument();
    expect(screen.queryByText("소원")).not.toBeInTheDocument();
  });

  it("가사를 길게 붙여 넣어도 앞 50자로 검색해 연결 실패로 보이지 않는다", async () => {
    const lyricMatch = { ...sharedSummary, id: LYRIC_MATCH_ID };
    api.restore();
    api = installFakeApi({
      "GET /api/catalog/search": ({ url }) => {
        const q = url.searchParams.get("q") ?? "";
        if (q.length > MAX_SEARCH_QUERY_LENGTH) {
          return { status: 400, body: { success: false, error: {} } };
        }
        return { body: { decks: q ? [lyricMatch] : [sharedSummary] } };
      },
    });
    renderPicker();
    await screen.findByTestId(`song-item-${SHARED_ID}`);

    const lyrics =
      "주 하나님 지으신 모든 세계 내 마음 속에 그리어 볼 때 하늘의 별 울려 퍼지는 뇌성 주님의 권능 우주에 찼네";
    expect(lyrics.length).toBeGreaterThan(MAX_SEARCH_QUERY_LENGTH);
    fireEvent.change(screen.getByTestId("song-picker-search-input"), {
      target: { value: lyrics },
    });

    expect(
      await screen.findByTestId(`song-item-${LYRIC_MATCH_ID}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("song-picker-offline-notice"),
    ).not.toBeInTheDocument();
    const searched = api.calls
      .filter((call) => call.path === "/api/catalog/search")
      .map((call) => new URLSearchParams(call.search).get("q"));
    expect(searched).toEqual(["", clampSearchQuery(lyrics)]);
  });

  it("공식 라이브러리 곡에만 공식 표시를 달아 같은 이름을 쓴 사람의 곡과 구별한다", async () => {
    const official = {
      ...sharedSummary,
      authorName: OFFICIAL_LIBRARY_NAME,
      official: true,
    };
    const lookalike = {
      ...sharedSummary,
      id: LYRIC_MATCH_ID,
      authorName: OFFICIAL_LIBRARY_NAME,
      official: false,
    };
    api.restore();
    installServer({ sharedDecks: [official, lookalike] });
    renderPicker();

    const officialRow = await screen.findByTestId(`song-item-${SHARED_ID}`);
    const lookalikeRow = screen.getByTestId(`song-item-${LYRIC_MATCH_ID}`);
    expect(
      within(officialRow).getByText(EDITOR_COPY.song.official),
    ).toBeInTheDocument();
    expect(
      within(lookalikeRow).queryByText(EDITOR_COPY.song.official),
    ).not.toBeInTheDocument();

    fireEvent.click(officialRow);
    const heading = screen.getByRole("heading", { name: official.title });
    expect(
      within(heading.parentElement as HTMLElement).getByText(
        EDITOR_COPY.song.official,
      ),
    ).toBeInTheDocument();

    fireEvent.click(lookalikeRow);
    expect(
      within(
        screen.getByRole("heading", { name: lookalike.title })
          .parentElement as HTMLElement,
      ).queryByText(EDITOR_COPY.song.official),
    ).not.toBeInTheDocument();
  });

  it("곡 항목은 키보드 Enter로도 고를 수 있다", async () => {
    seedMySong();
    renderPicker();

    const item = await screen.findByTestId(`song-item-${SHARED_ID}`);
    expect(item).toHaveAttribute("aria-pressed", "false");
    item.focus();
    fireEvent.keyDown(item, { key: "Enter" });

    expect(item).toHaveAttribute("aria-pressed", "true");
  });

  it("닫혀 있다가 열려도 렌더링이 깨지지 않는다", () => {
    seedMySong();
    const { rerender } = render(
      withQueryClient(
        <SongPickerModal
          isOpen={false}
          onClose={onCloseMock}
          onSelectSong={onSelectSongMock}
        />,
      ),
    );

    rerender(
      withQueryClient(
        <SongPickerModal
          isOpen={true}
          onClose={onCloseMock}
          onSelectSong={onSelectSongMock}
        />,
      ),
    );
    expect(screen.getByTestId("song-picker-modal")).toBeInTheDocument();
  });

  it("내 곡을 골라 추가하면 onSelectSong이 호출된다", () => {
    const mine = seedMySong();
    renderPicker();

    fireEvent.click(screen.getByTestId("song-picker-add-btn"));
    expect(onSelectSongMock).toHaveBeenCalledWith(mine);
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it("내 보관함 곡은 가사 복사 버튼을 제공한다", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    seedMySong();
    renderPicker();

    fireEvent.click(screen.getByTestId("song-picker-copy-lyrics-btn"));
    expect(
      await screen.findByText(EDITOR_COPY.preview.lyricsCopied),
    ).toBeInTheDocument();
    expect(screen.getByText("넷째 줄")).toBeInTheDocument();
  });

  describe("내 보관함 곡 관리", () => {
    it("제목·아티스트를 고치면 보관함과 목록에 반영된다", () => {
      const mine = seedMySong();
      renderPicker();

      fireEvent.click(screen.getByTestId("song-picker-edit-info-btn"));
      expect(screen.getByTestId("song-info-title-input")).toHaveValue(
        "내가 만든 찬양",
      );
      fireEvent.change(screen.getByTestId("song-info-title-input"), {
        target: { value: "고친 제목" },
      });
      fireEvent.change(screen.getByTestId("song-info-artist-input"), {
        target: { value: "" },
      });
      fireEvent.click(screen.getByTestId("song-info-save-btn"));

      expect(screen.queryByTestId("song-info-dialog")).not.toBeInTheDocument();
      expect(getUserSongs()).toHaveLength(1);
      expect(getUserSongs()[0]).toMatchObject({
        id: mine.id,
        title: "고친 제목",
        artist: "",
      });
      expect(screen.getByTestId(`song-item-${mine.id}`)).toHaveTextContent(
        "고친 제목",
      );
    });

    it("수정 창의 Esc는 수정 창만 닫고 곡 추가 창은 남긴다", () => {
      seedMySong();
      renderPicker();

      fireEvent.click(screen.getByTestId("song-picker-edit-info-btn"));
      fireEvent.keyDown(document, { key: "Escape" });

      expect(screen.queryByTestId("song-info-dialog")).not.toBeInTheDocument();
      expect(onCloseMock).not.toHaveBeenCalled();
      expect(getUserSongs()[0].title).toBe("내가 만든 찬양");
    });

    it("보관함 곡 미리보기에서 공개를 시작하고, 동의 창의 Esc는 곡 추가 창을 닫지 않는다", () => {
      seedMySong();
      renderPicker();

      expect(screen.getByTestId("song-share-status")).toHaveTextContent(
        "비공개",
      );
      fireEvent.click(screen.getByTestId("song-share-publish-btn"));
      expect(screen.getByTestId("publish-dialog")).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onCloseMock).not.toHaveBeenCalled();
    });

    it("공개 요청이 나가는 동안 Esc는 동의 창도 곡 추가 창도 닫지 않는다", async () => {
      api.restore();
      api = installFakeApi({
        "GET /api/catalog/search": () => ({ body: { decks: [] } }),
        "PUT /api/decks/*": ({ body }) => ({ body: { ok: true, deck: body } }),
        "PATCH /api/decks/*/visibility": () => new Promise(() => undefined),
      });
      seedMySong();
      renderPicker();
      fireEvent.click(screen.getByTestId("song-share-publish-btn"));
      fireEvent.click(screen.getByTestId("publish-accept-checkbox"));
      fireEvent.click(screen.getByTestId("publish-confirm-btn"));
      await waitFor(() =>
        expect(api.calls.some((call) => call.method === "PATCH")).toBe(true),
      );

      fireEvent.keyDown(document, { key: "Escape" });

      expect(screen.getByTestId("publish-dialog")).toBeInTheDocument();
      expect(screen.getByTestId("song-picker-modal")).toBeInTheDocument();
      expect(onCloseMock).not.toHaveBeenCalled();
    });

    it("확인을 거쳐 보관함에서 삭제한다", () => {
      const mine = seedMySong();
      renderPicker();

      fireEvent.click(screen.getByTestId("song-picker-delete-btn"));
      expect(screen.getByTestId("drive-confirm-dialog")).toHaveTextContent(
        "이미 넣은 곡은 그대로 남아요",
      );
      fireEvent.click(screen.getByTestId("drive-confirm-btn"));

      expect(getUserSongs()).toHaveLength(0);
      expect(
        screen.queryByTestId(`song-item-${mine.id}`),
      ).not.toBeInTheDocument();
      expect(onCloseMock).not.toHaveBeenCalled();
    });

    it("공개하려는 곡을 서버가 이미 지운 곡이라고 하면 목록에서 빼고 남은 곡 미리보기에 대화 상자와 오류를 남기지 않는다", async () => {
      api.restore();
      api = installFakeApi({
        "GET /api/catalog/search": () => ({ body: { decks: [] } }),
        "PUT /api/decks/*": () => ({
          status: 410,
          body: { error: "이미 지운 곡이에요" },
        }),
      });
      const kept = seedMySong("남는 곡");
      const gone = seedMySong("다른 기기에서 지운 곡");
      renderPicker();
      expect(screen.getByTestId(`song-item-${gone.id}`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      fireEvent.click(screen.getByTestId("song-share-publish-btn"));
      fireEvent.click(screen.getByTestId("publish-accept-checkbox"));
      fireEvent.click(screen.getByTestId("publish-confirm-btn"));

      await waitFor(() =>
        expect(
          screen.queryByTestId(`song-item-${gone.id}`),
        ).not.toBeInTheDocument(),
      );
      expect(getUserSongs().map((deck) => deck.id)).toEqual([kept.id]);
      expect(screen.getByTestId(`song-item-${kept.id}`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.queryByTestId("publish-dialog")).not.toBeInTheDocument();
      expect(screen.queryByText("이미 지운 곡이에요")).not.toBeInTheDocument();
      expect(screen.getByTestId("song-share-status")).toHaveTextContent(
        "비공개",
      );
    });

    it("공개한 곡을 지우려 하면 공유 라이브러리에서도 내려간다고 알린다", () => {
      upsertLibraryDeck(
        { ...seedMySong(), visibility: "public" },
        { push: false },
      );
      renderPicker();

      fireEvent.click(screen.getByTestId("song-picker-delete-btn"));
      expect(screen.getByTestId("drive-confirm-dialog")).toHaveTextContent(
        "공유 라이브러리에서도 내려가요",
      );

      fireEvent.click(screen.getByRole("button", { name: COMMON_COPY.cancel }));
      expect(getUserSongs()).toHaveLength(1);
    });
  });

  describe("공유 곡", () => {
    it("로그인 사용자에게 가사 전문을 미리 보여 준다", async () => {
      renderPicker();
      fireEvent.click(await screen.findByTestId(`song-item-${SHARED_ID}`));

      expect(await screen.findByText("당신은 시간을 뚫고")).toBeInTheDocument();
      expect(
        screen.getByText("우리 없는 하늘을 원치 않아"),
      ).toBeInTheDocument();
      expect(screen.getByText(/공유: 김찬양/)).toBeInTheDocument();
      expect(
        screen.getByTestId("song-picker-copy-lyrics-btn"),
      ).toBeInTheDocument();
    });

    it("가져오기(fork)로 내 보관함에 넣은 뒤 세트에 추가한다", async () => {
      renderPicker();
      fireEvent.click(await screen.findByTestId(`song-item-${SHARED_ID}`));
      fireEvent.click(screen.getByTestId("song-picker-add-btn"));

      await waitFor(() => expect(onSelectSongMock).toHaveBeenCalledTimes(1));
      expect(onSelectSongMock.mock.calls[0][0]).toMatchObject({
        id: FORK_ID,
        forkedFrom: SHARED_ID,
        origin: "fork",
      });
      expect(getUserSongs().map((d) => d.id)).toEqual([FORK_ID]);
      expect(
        api.calls.some(
          (c) =>
            c.method === "POST" && c.path === `/api/decks/${SHARED_ID}/fork`,
        ),
      ).toBe(true);
    });

    it("이미 가져온 곡은 다시 가져오지 않고 보관함의 사본을 쓴다", async () => {
      const { upsertLibraryDeck } = await import("./songLibraryStore");
      upsertLibraryDeck(forkedDeck(), { push: false });
      renderPicker();

      fireEvent.click(await screen.findByTestId(`song-item-${SHARED_ID}`));
      expect(
        screen.getByText(EDITOR_COPY.picker.inLibrary),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("song-picker-add-btn"));

      expect(onSelectSongMock.mock.calls[0][0].id).toBe(FORK_ID);
      expect(api.calls.some((c) => c.path.endsWith("/fork"))).toBe(false);
    });

    it("가져온 곡을 지우고 지우기를 보내기 전에 다시 가져오면 서버에서 지우지 않는다", async () => {
      setDeckSyncEnabled(true);
      api.restore();
      let alreadyOwned = false;
      api = installFakeApi({
        "GET /api/catalog/search": () => ({ body: { decks: [sharedSummary] } }),
        "GET /api/catalog/decks/*": () => ({
          status: 404,
          body: { error: "x" },
        }),
        "POST /api/decks/*/fork": () => {
          const body = { deck: forkedDeck(), alreadyOwned };
          alreadyOwned = true;
          return { body };
        },
        "DELETE /api/decks/*": () => ({ body: { ok: true } }),
      });
      renderPicker();

      fireEvent.click(await screen.findByTestId(`song-item-${SHARED_ID}`));
      fireEvent.click(screen.getByTestId("song-picker-add-btn"));
      await waitFor(() =>
        expect(getUserSongs().map((deck) => deck.id)).toEqual([FORK_ID]),
      );

      fireEvent.click(screen.getByTestId(`song-item-${FORK_ID}`));
      fireEvent.click(screen.getByTestId("song-picker-delete-btn"));
      fireEvent.click(screen.getByTestId("drive-confirm-btn"));
      expect(getUserSongs()).toEqual([]);

      fireEvent.click(screen.getByTestId(`song-item-${SHARED_ID}`));
      fireEvent.click(screen.getByTestId("song-picker-add-btn"));
      await waitFor(() =>
        expect(getUserSongs().map((deck) => deck.id)).toEqual([FORK_ID]),
      );
      await flushDeckSync();

      expect(
        api.calls.some(
          (call) =>
            call.method === "DELETE" && call.path === `/api/decks/${FORK_ID}`,
        ),
      ).toBe(false);
      expect(getUserSongs()[0]).toMatchObject({
        forkedFrom: SHARED_ID,
        origin: "fork",
      });
    });

    it("가져오기가 실패하면 이유를 보여 주고 세트에 넣지 않는다", async () => {
      api.restore();
      api = installFakeApi({
        "GET /api/catalog/search": () => ({
          body: { decks: [sharedSummary] },
        }),
        "GET /api/catalog/decks/*": () => ({
          status: 404,
          body: { error: "x" },
        }),
        "POST /api/decks/*/fork": () => ({
          status: 404,
          body: { error: API_ERRORS.deck.notPublished },
        }),
      });
      renderPicker();
      fireEvent.click(await screen.findByTestId(`song-item-${SHARED_ID}`));
      fireEvent.click(screen.getByTestId("song-picker-add-btn"));

      expect(
        await screen.findByText(API_ERRORS.deck.notPublished),
      ).toBeInTheDocument();
      expect(onSelectSongMock).not.toHaveBeenCalled();
    });

    describe("가져오는 중에 창을 벗어날 때", () => {
      function ClosablePicker(): React.JSX.Element {
        const [isOpen, setIsOpen] = React.useState(true);
        return (
          <SongPickerModal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            onSelectSong={onSelectSongMock}
          />
        );
      }

      function installDeferredFork(): {
        release: () => Promise<void>;
        fail: () => Promise<void>;
        forkCalls: () => number;
      } {
        api.restore();
        let resolveFork: () => void = () => undefined;
        let failFork: () => void = () => undefined;
        api = installFakeApi({
          "GET /api/catalog/search": () => ({
            body: { decks: [sharedSummary] },
          }),
          "GET /api/catalog/decks/*": () => ({
            body: {
              deck: {
                ...sharedSummary,
                lyricsRaw: SHARED_LYRICS,
                slides: forkedDeck().slides,
                style: DEFAULT_DECK_STYLE,
              },
            },
          }),
          "POST /api/decks/*/fork": () =>
            new Promise((resolve) => {
              resolveFork = () =>
                resolve({
                  body: { deck: forkedDeck(), alreadyOwned: false },
                });
              failFork = () =>
                resolve({
                  status: 404,
                  body: { error: API_ERRORS.deck.notPublished },
                });
            }),
        });
        return {
          release: () =>
            act(async () => {
              resolveFork();
            }),
          fail: () =>
            act(async () => {
              failFork();
            }),
          forkCalls: () =>
            api.calls.filter((call) => call.path.endsWith("/fork")).length,
        };
      }

      function reopenablePicker(): {
        picker: (isOpen: boolean) => React.ReactElement;
        client: QueryClient;
      } {
        const client = createTestQueryClient();
        return {
          client,
          picker: (isOpen) =>
            withQueryClient(
              <SongPickerModal
                isOpen={isOpen}
                onClose={onCloseMock}
                onSelectSong={onSelectSongMock}
              />,
              client,
            ),
        };
      }

      async function startFork(forkCalls: () => number): Promise<void> {
        fireEvent.click(await screen.findByTestId(`song-item-${SHARED_ID}`));
        fireEvent.click(screen.getByTestId("song-picker-add-btn"));
        await waitFor(() => expect(forkCalls()).toBe(1));
      }

      async function expectForkKeptOnlyInLibrary(): Promise<void> {
        await waitFor(() =>
          expect(getUserSongs().map((deck) => deck.id)).toEqual([FORK_ID]),
        );
        expect(onSelectSongMock).not.toHaveBeenCalled();
      }

      const actionBarClose = (): HTMLElement =>
        screen
          .getAllByRole("button", { name: COMMON_COPY.close })
          .find(
            (button) => button.dataset.slot !== "dialog-close",
          ) as HTMLElement;

      it.each([
        ["닫기 버튼을 눌러", () => fireEvent.click(actionBarClose())],
        ["Esc를 눌러", () => fireEvent.keyDown(document, { key: "Escape" })],
      ])(
        "가져오는 중에 %s 창을 닫으면 가져온 곡을 세트에 넣지 않고 보관함에만 남긴다",
        async (_name, dismiss) => {
          const fork = installDeferredFork();
          render(withQueryClient(<ClosablePicker />));
          await startFork(fork.forkCalls);

          dismiss();
          await waitFor(() =>
            expect(
              screen.queryByTestId("song-picker-modal"),
            ).not.toBeInTheDocument(),
          );
          await fork.release();

          await expectForkKeptOnlyInLibrary();
        },
      );

      it("가져오는 중에 창을 닫았다 다시 열어도 앞서 시작한 가져오기는 세트에 넣지 않는다", async () => {
        const fork = installDeferredFork();
        const client = createTestQueryClient();
        const picker = (isOpen: boolean) =>
          withQueryClient(
            <SongPickerModal
              isOpen={isOpen}
              onClose={onCloseMock}
              onSelectSong={onSelectSongMock}
            />,
            client,
          );
        const view = render(picker(true));
        await startFork(fork.forkCalls);

        view.rerender(picker(false));
        view.rerender(picker(true));
        await fork.release();

        await expectForkKeptOnlyInLibrary();
      });

      it("가져오는 중에 닫았다 다시 연 창은 앞선 가져오기를 기다리지 않는다", async () => {
        const fork = installDeferredFork();
        const { picker } = reopenablePicker();
        const view = render(picker(true));
        await startFork(fork.forkCalls);

        view.rerender(picker(false));
        view.rerender(picker(true));
        fireEvent.click(await screen.findByTestId(`song-item-${SHARED_ID}`));

        const addButton = screen.getByTestId("song-picker-add-btn");
        expect(addButton).toBeEnabled();
        expect(addButton).not.toHaveTextContent(EDITOR_COPY.preview.importing);
        await fork.release();
        await expectForkKeptOnlyInLibrary();
      });

      it("가져오는 중에 닫았다 다시 연 창에는 앞선 가져오기의 실패를 보여 주지 않는다", async () => {
        const fork = installDeferredFork();
        const { picker, client } = reopenablePicker();
        const view = render(picker(true));
        await startFork(fork.forkCalls);

        view.rerender(picker(false));
        view.rerender(picker(true));
        fireEvent.click(await screen.findByTestId(`song-item-${SHARED_ID}`));
        await fork.fail();
        await waitFor(() => expect(client.isMutating()).toBe(0));
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(
          screen.queryByText(API_ERRORS.deck.notPublished),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("song-picker-add-btn")).toBeEnabled();
        expect(onSelectSongMock).not.toHaveBeenCalled();
      });

      it("닫히는 애니메이션 중인 창에서 누른 추가는 곡을 가져오지도 세트에 넣지도 않는다", async () => {
        const fork = installDeferredFork();
        const { picker } = reopenablePicker();
        const view = render(picker(true));
        fireEvent.click(await screen.findByTestId(`song-item-${SHARED_ID}`));
        const addButton = screen.getByTestId("song-picker-add-btn");
        const exitAnimation = {
          finished: new Promise<never>(() => undefined),
        } as unknown as Animation;
        Object.defineProperty(Element.prototype, "getAnimations", {
          configurable: true,
          value: () => [exitAnimation],
        });

        try {
          view.rerender(picker(false));
          expect(addButton).toBeInTheDocument();
          fireEvent.click(addButton);
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          view.unmount();
        } finally {
          Reflect.deleteProperty(Element.prototype, "getAnimations");
        }

        expect(fork.forkCalls()).toBe(0);
        expect(onSelectSongMock).not.toHaveBeenCalled();
      });

      it("가져오는 중에 화면을 떠나도 가져온 곡을 세트에 넣지 않는다", async () => {
        const fork = installDeferredFork();
        const view = renderPicker();
        await startFork(fork.forkCalls);

        view.unmount();
        await fork.release();

        await expectForkKeptOnlyInLibrary();
      });

      it("창을 닫지 않았다면 가져온 곡을 세트에 넣고 창을 닫는다", async () => {
        const fork = installDeferredFork();
        renderPicker();
        await startFork(fork.forkCalls);

        await fork.release();

        await waitFor(() => expect(onSelectSongMock).toHaveBeenCalledTimes(1));
        expect(onSelectSongMock.mock.calls[0][0]).toMatchObject({
          id: FORK_ID,
        });
        expect(onCloseMock).toHaveBeenCalledTimes(1);
      });
    });

    it("오프라인이면 가져오기를 멈춰 두지 않고 곧바로 실패를 알리며, 온라인이 돼도 보내지 않는다", async () => {
      renderPicker();
      fireEvent.click(await screen.findByTestId(`song-item-${SHARED_ID}`));
      api.restore();
      api = installFakeApi({}, { offline: true });
      onlineManager.setOnline(false);

      fireEvent.click(screen.getByTestId("song-picker-add-btn"));

      const forkCalls = () =>
        api.calls.filter((call) => call.path.endsWith("/fork")).length;
      expect(await screen.findByText(ERROR_COPY.offline)).toBeInTheDocument();
      expect(forkCalls()).toBe(1);
      onlineManager.setOnline(true);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(forkCalls()).toBe(1);
      expect(onSelectSongMock).not.toHaveBeenCalled();
    });

    it("신고를 보낼 수 있다", async () => {
      renderPicker();
      fireEvent.click(await screen.findByTestId(`song-item-${SHARED_ID}`));
      fireEvent.click(screen.getByTestId("song-picker-report-btn"));
      fireEvent.click(screen.getByTestId("report-reason-copyright"));
      fireEvent.click(screen.getByTestId("report-submit-btn"));

      expect(
        await screen.findByTestId("report-dialog-done"),
      ).toBeInTheDocument();
      const report = api.calls.find((c) => c.path === "/api/reports");
      expect(report?.body).toEqual({
        targetType: "deck",
        targetId: SHARED_ID,
        reason: "copyright",
      });
    });
  });

  describe("오프라인", () => {
    it("서버에 닿지 못하면 내 곡만 보여 준다", async () => {
      api.restore();
      installServer({ offline: true });
      seedMySong();
      renderPicker();

      expect(
        await screen.findByTestId("song-picker-offline-notice"),
      ).toBeInTheDocument();
      expect(screen.getAllByText("내가 만든 찬양").length).toBeGreaterThan(0);
    });

    it("검색이 몰려 서버가 429로 막으면 연결 실패 대신 잠시 후 다시 검색하라고 알린다", async () => {
      api.restore();
      api = installFakeApi({
        "GET /api/catalog/search": () => ({
          status: 429,
          body: { error: API_ERRORS.tooManyRequests },
        }),
      });
      seedMySong();
      renderPicker();

      expect(
        await screen.findByTestId("song-picker-offline-notice"),
      ).toHaveTextContent(EDITOR_COPY.picker.rateLimited);
      expect(
        screen.queryByText(EDITOR_COPY.picker.serverUnavailable),
      ).not.toBeInTheDocument();
      expect(screen.getAllByText("내가 만든 찬양").length).toBeGreaterThan(0);
    });

    it("브라우저가 오프라인이면 서버를 부르지 않는다", () => {
      const onLine = vi
        .spyOn(navigator, "onLine", "get")
        .mockReturnValue(false);
      renderPicker();
      expect(screen.getByText(EDITOR_COPY.picker.offline)).toBeInTheDocument();
      expect(api.calls).toHaveLength(0);
      onLine.mockRestore();
    });
  });

  describe("직접 등록", () => {
    function fillCreateForm(title = "새로운 찬양") {
      fireEvent.click(screen.getByTestId("song-picker-switch-create-btn"));
      fireEvent.change(screen.getByTestId("song-picker-create-title-input"), {
        target: { value: title },
      });
      fireEvent.change(screen.getByTestId("song-picker-create-artist-input"), {
        target: { value: "사명자" },
      });
      fireEvent.change(screen.getByTestId("song-picker-create-lyrics-input"), {
        target: {
          value: "은혜로다 주의 은혜\n한량없는 주의 은혜\n\n나를 살리신 주",
        },
      });
    }

    it("새 곡을 저장하고 세트에 추가한다", async () => {
      renderPicker();
      fillCreateForm();
      fireEvent.click(screen.getByTestId("song-picker-create-submit-btn"));

      await waitFor(() => expect(onSelectSongMock).toHaveBeenCalledTimes(1));
      const added = onSelectSongMock.mock.calls[0][0];
      expect(added).toMatchObject({
        title: "새로운 찬양",
        artist: "사명자",
      });
      expect(added.slides).toHaveLength(2);
    });

    it("153자 메들리 제목으로 찾다가 새 곡으로 등록해도 곡 제목 한도로 줄여 저장한다", async () => {
      const medley =
        "오 거룩하신 주님 (O Sacred Head, Now Wounded) _ 주 달려 죽은 십자가 (When I Survey The Wondrous Cross) _ 예수 나를 위하여 (Near The Cross) _ 내 구주 예수를 더욱 사랑 (More Love To Thee)";
      expect(medley.length).toBeGreaterThan(MAX_DECK_TITLE_LENGTH);
      renderPicker();

      fireEvent.change(screen.getByTestId("song-picker-search-input"), {
        target: { value: medley },
      });
      const searched = (): string[] =>
        api.calls
          .filter((call) => call.path === "/api/catalog/search")
          .map((call) => new URLSearchParams(call.search).get("q") ?? "");
      await waitFor(() =>
        expect(searched()).toContain(clampSearchQuery(medley)),
      );
      expect(searched().every((q) => q.length <= MAX_SEARCH_QUERY_LENGTH)).toBe(
        true,
      );

      fireEvent.click(screen.getByTestId("song-picker-switch-create-btn"));
      fireEvent.change(screen.getByTestId("song-picker-create-lyrics-input"), {
        target: { value: "오 거룩하신 주님\n\n주 달려 죽은 십자가" },
      });
      fireEvent.click(screen.getByTestId("song-picker-create-submit-btn"));

      await waitFor(() => expect(onSelectSongMock).toHaveBeenCalledTimes(1));
      const saved: Deck = onSelectSongMock.mock.calls[0][0];
      expect(saved.title.length).toBeLessThanOrEqual(MAX_DECK_TITLE_LENGTH);
      expect(medley.startsWith(saved.title)).toBe(true);
    });

    it("화면 밖에서 넣은 101자 제목도 곡 제목 한도로 줄여 저장한다", async () => {
      renderPicker();
      fillCreateForm("가".repeat(101));
      fireEvent.click(screen.getByTestId("song-picker-create-submit-btn"));

      await waitFor(() => expect(onSelectSongMock).toHaveBeenCalledTimes(1));
      expect(onSelectSongMock.mock.calls[0][0].title).toBe("가".repeat(100));
    });

    it("제목·아티스트·가사 칸은 한도까지만 받고, 가사가 한도에 이르면 안내를 보여 준다", () => {
      renderPicker();
      fireEvent.click(screen.getByTestId("song-picker-switch-create-btn"));
      const lyrics = screen.getByTestId("song-picker-create-lyrics-input");

      expect(
        screen.getByTestId("song-picker-create-title-input"),
      ).toHaveProperty("maxLength", MAX_DECK_TITLE_LENGTH);
      expect(
        screen.getByTestId("song-picker-create-artist-input"),
      ).toHaveProperty("maxLength", MAX_DECK_ARTIST_LENGTH);
      expect(lyrics).toHaveProperty("maxLength", MAX_LYRICS_LENGTH);
      const hint = EDITOR_COPY.create.lyricsLimit(MAX_LYRICS_LENGTH);
      expect(screen.queryByText(hint)).not.toBeInTheDocument();

      fireEvent.change(lyrics, {
        target: { value: "가".repeat(MAX_LYRICS_LENGTH) },
      });

      expect(screen.getByText(hint)).toBeInTheDocument();
    });

    describe("가사 불러오기", () => {
      function openCreateForm(title: string, artist = "") {
        fireEvent.click(screen.getByTestId("song-picker-switch-create-btn"));
        fireEvent.change(screen.getByTestId("song-picker-create-title-input"), {
          target: { value: title },
        });
        if (artist) {
          fireEvent.change(
            screen.getByTestId("song-picker-create-artist-input"),
            { target: { value: artist } },
          );
        }
      }

      const lyricsCalls = (): string[] =>
        api.calls
          .filter((call) => call.path.startsWith("/api/lyrics/"))
          .map((call) => call.path);

      it("제목이 비어 있으면 버튼이 막혀 있고, 입력하는 동안에는 서버를 부르지 않는다", () => {
        renderPicker();
        openCreateForm("");
        const button = screen.getByTestId("song-picker-lyrics-import-btn");

        expect(button).toBeDisabled();
        expect(screen.getByText(EDITOR_COPY.lyricsImport.source)).toBeVisible();

        fireEvent.change(screen.getByTestId("song-picker-create-title-input"), {
          target: { value: "은혜 위에 은혜" },
        });

        expect(button).toBeEnabled();
        expect(lyricsCalls()).toEqual([]);
      });

      it("후보를 골라 가사를 채우고 가수 칸이 비어 있으면 가수도 채운다", async () => {
        renderPicker();
        openCreateForm("은혜 위에 은혜");
        fireEvent.click(screen.getByTestId("song-picker-lyrics-import-btn"));

        fireEvent.click(
          await screen.findByRole("button", { name: "은혜 위에 은혜 · 해준" }),
        );

        await waitFor(() =>
          expect(
            screen.getByTestId("song-picker-create-lyrics-input"),
          ).toHaveValue("어두워진 나의 눈\n바라 볼 수 없네\n은혜 위에 은혜"),
        );
        expect(
          screen.getByTestId("song-picker-create-artist-input"),
        ).toHaveValue("해준");
        const search = api.calls.find((c) => c.path === "/api/lyrics/search");
        expect(new URLSearchParams(search?.search).get("title")).toBe(
          "은혜 위에 은혜",
        );
      });

      it("가수 칸에 이미 적은 이름은 바꾸지 않는다", async () => {
        renderPicker();
        openCreateForm("은혜 위에 은혜", "내가 적은 가수");
        fireEvent.click(screen.getByTestId("song-picker-lyrics-import-btn"));

        fireEvent.click(
          await screen.findByRole("button", { name: "은혜 위에 은혜 · 해준" }),
        );

        await waitFor(() =>
          expect(
            screen.getByTestId("song-picker-create-lyrics-input"),
          ).not.toHaveValue(""),
        );
        expect(
          screen.getByTestId("song-picker-create-artist-input"),
        ).toHaveValue("내가 적은 가수");
      });

      it("찾은 곡이 없으면 안내 문장을 보여 준다", async () => {
        renderPicker();
        openCreateForm("없는 노래");
        fireEvent.click(screen.getByTestId("song-picker-lyrics-import-btn"));

        expect(
          await screen.findByTestId("song-picker-lyrics-import-empty"),
        ).toHaveTextContent(EDITOR_COPY.lyricsImport.empty);
      });

      it("서버가 실패하면 서버가 준 문장을 보여 준다", async () => {
        api.restore();
        api = installFakeApi({
          "GET /api/lyrics/search": () => ({
            status: 502,
            body: { error: API_ERRORS.lyrics.unavailable },
          }),
        });
        renderPicker();
        openCreateForm("은혜 위에 은혜");
        fireEvent.click(screen.getByTestId("song-picker-lyrics-import-btn"));

        expect(
          await screen.findByTestId("song-picker-lyrics-import-error"),
        ).toHaveTextContent(API_ERRORS.lyrics.unavailable);
      });
    });

    it("같은 제목의 공유 곡이 있어도 묻지 않고 바로 저장한다", async () => {
      renderPicker();
      fillCreateForm("시간을 뚫고");
      fireEvent.click(screen.getByTestId("song-picker-create-submit-btn"));

      await waitFor(() => expect(onSelectSongMock).toHaveBeenCalledTimes(1));
      expect(onSelectSongMock.mock.calls[0][0]).toMatchObject({
        title: "시간을 뚫고",
        origin: "user",
      });
      expect(getUserSongs()).toHaveLength(1);
      expect(
        api.calls.some((c) => c.path.startsWith("/api/catalog/candidates")),
      ).toBe(false);
    });
  });

  describe("initialMode", () => {
    it("create로 열면 목록 대신 가사 직접 입력 폼을 바로 보여 준다", () => {
      seedMySong();
      render(
        withQueryClient(
          <SongPickerModal
            isOpen={true}
            initialMode="create"
            onClose={onCloseMock}
            onSelectSong={onSelectSongMock}
          />,
        ),
      );

      expect(screen.getByText(EDITOR_COPY.create.title)).toBeInTheDocument();
      expect(
        screen.queryByTestId("song-picker-add-btn"),
      ).not.toBeInTheDocument();
    });

    it("다시 열 때 이전에 보던 곡이 아니라 지정한 화면으로 연다", () => {
      seedMySong();
      const renderWith = (isOpen: boolean, initialMode: "browse" | "create") =>
        withQueryClient(
          <SongPickerModal
            isOpen={isOpen}
            initialMode={initialMode}
            onClose={onCloseMock}
            onSelectSong={onSelectSongMock}
          />,
        );
      const { rerender } = render(renderWith(true, "browse"));
      expect(screen.getByTestId("song-picker-add-btn")).toBeInTheDocument();

      rerender(renderWith(false, "browse"));
      rerender(renderWith(true, "create"));

      expect(
        screen.getByTestId("song-picker-create-lyrics-input"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("song-picker-add-btn"),
      ).not.toBeInTheDocument();
    });
  });

  describe("빈 상태 및 수량 표기", () => {
    it("공유 곡 탭에서 공유 곡이 없을 때 검색 전 문구를 표시한다", async () => {
      api.restore();
      installServer({ sharedDecks: [] });
      renderPicker();

      fireEvent.click(screen.getByTestId("song-picker-filter-shared"));
      expect(
        await screen.findByText(EDITOR_COPY.picker.noShared),
      ).toBeInTheDocument();
    });

    it("검색 결과가 없을 때는 '일치하는 찬양곡이 없습니다.'를 표시한다", async () => {
      renderPicker();
      fireEvent.change(screen.getByTestId("song-picker-search-input"), {
        target: { value: "존재하지않는찬양" },
      });

      expect(
        await screen.findByText(EDITOR_COPY.picker.noMatch),
      ).toBeInTheDocument();
    });

    it("내 보관함 곡 미리보기에 '슬라이드 N장'으로 표기한다", () => {
      seedMySong();
      renderPicker();

      expect(screen.getByText(/슬라이드 2장/)).toBeInTheDocument();
      expect(screen.queryByText(/소절/)).not.toBeInTheDocument();
    });
  });

  describe("폰 폭(md 미만) 배치", () => {
    it("목록 아래의 미리보기와 추가 버튼까지 본문을 통째로 밀어서 닿고, 목록과 가사는 높이를 제한한다", () => {
      seedMySong();
      renderPicker();

      const body = screen.getByTestId("song-picker-body");

      expect(body).toHaveClass("max-md:overflow-y-auto");
      expect(body.firstElementChild).toHaveClass("max-md:max-h-72");
      expect(body).toContainElement(screen.getByTestId("song-picker-add-btn"));
      expect(screen.getByTestId("song-picker-lyrics")).toHaveClass(
        "max-md:max-h-64",
      );
    });

    it("동작 줄은 좁으면 줄을 바꿔서 추가 버튼이 대화 상자 오른쪽 밖으로 밀려 나가지 않는다", () => {
      seedMySong();
      renderPicker();

      const actions = screen.getByTestId("song-picker-actions");

      expect(actions).toHaveClass("max-md:flex-wrap");
      expect(actions).toContainElement(
        screen.getByTestId("song-picker-add-btn"),
      );
    });

    it("md 이상에서는 목록과 미리보기가 나란히 놓이고 각자 스크롤한다", () => {
      seedMySong();
      renderPicker();

      const body = screen.getByTestId("song-picker-body");

      expect(body).toHaveClass("overflow-hidden", "md:flex-row");
      expect(body.firstElementChild).toHaveClass("md:w-5/12");
    });
  });
});
