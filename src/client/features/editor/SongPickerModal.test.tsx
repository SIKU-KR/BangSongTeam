import React from "react";
import { signInAsTestUser } from "../../test/sessionFixture";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DEFAULT_DECK_STYLE, type Deck } from "#shared";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../../lib/storage";
import { withQueryClient } from "../../test/queryClientFixture";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { SEED_USER_ID } from "../presentation";
import { SongPickerModal } from "./SongPickerModal";
import {
  getUserSongs,
  resetSongLibraryStore,
  saveSongToLibrary,
  upsertLibraryDeck,
} from "./songLibraryStore";

const SHARED_ID = "c00000005000000000001";
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
    api.restore();
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

    expect(screen.getByText("찬양곡 추가")).toBeInTheDocument();
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
    expect(await screen.findByText("가사 복사됨 ✓")).toBeInTheDocument();
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

    it("확인을 거쳐 보관함에서 삭제한다", () => {
      const mine = seedMySong();
      renderPicker();

      fireEvent.click(screen.getByTestId("song-picker-delete-btn"));
      expect(screen.getByTestId("drive-confirm-dialog")).toHaveTextContent(
        "이미 세트에 넣은 곡은 그대로 남습니다",
      );
      fireEvent.click(screen.getByTestId("drive-confirm-btn"));

      expect(getUserSongs()).toHaveLength(0);
      expect(
        screen.queryByTestId(`song-item-${mine.id}`),
      ).not.toBeInTheDocument();
      expect(onCloseMock).not.toHaveBeenCalled();
    });

    it("공개한 곡을 지우려 하면 공유 라이브러리에서도 내려간다고 알린다", () => {
      upsertLibraryDeck(
        { ...seedMySong(), visibility: "public" },
        { push: false },
      );
      renderPicker();

      fireEvent.click(screen.getByTestId("song-picker-delete-btn"));
      expect(screen.getByTestId("drive-confirm-dialog")).toHaveTextContent(
        "공유 라이브러리에서도 내려갑니다",
      );

      fireEvent.click(screen.getByRole("button", { name: "취소" }));
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
      expect(screen.getByText("보관함에 있음")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("song-picker-add-btn"));

      expect(onSelectSongMock.mock.calls[0][0].id).toBe(FORK_ID);
      expect(api.calls.some((c) => c.path.endsWith("/fork"))).toBe(false);
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
          body: { error: "공개된 곡을 찾을 수 없습니다" },
        }),
      });
      renderPicker();
      fireEvent.click(await screen.findByTestId(`song-item-${SHARED_ID}`));
      fireEvent.click(screen.getByTestId("song-picker-add-btn"));

      expect(
        await screen.findByText("공개된 곡을 찾을 수 없습니다"),
      ).toBeInTheDocument();
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

    it("브라우저가 오프라인이면 서버를 부르지 않는다", () => {
      const onLine = vi
        .spyOn(navigator, "onLine", "get")
        .mockReturnValue(false);
      renderPicker();
      expect(
        screen.getByText("오프라인 — 내 곡만 표시합니다"),
      ).toBeInTheDocument();
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

      expect(screen.getByText("새 찬양 가사 직접 입력")).toBeInTheDocument();
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
        await screen.findByText("아직 공유된 찬양곡이 없습니다."),
      ).toBeInTheDocument();
    });

    it("검색 결과가 없을 때는 '일치하는 찬양곡이 없습니다.'를 표시한다", async () => {
      renderPicker();
      fireEvent.change(screen.getByTestId("song-picker-search-input"), {
        target: { value: "존재하지않는찬양" },
      });

      expect(
        await screen.findByText("일치하는 찬양곡이 없습니다."),
      ).toBeInTheDocument();
    });

    it("내 보관함 곡 미리보기에 '총 N개 슬라이드'로 표기한다", () => {
      seedMySong();
      renderPicker();

      expect(screen.getByText(/총 2개 슬라이드/)).toBeInTheDocument();
      expect(screen.queryByText(/소절/)).not.toBeInTheDocument();
    });
  });
});
