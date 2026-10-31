import React from "react";
import { signInAsTestUser } from "../../test/sessionFixture";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import {
  API_ERRORS,
  type Deck,
  MAX_DECK_ARTIST_LENGTH,
  MAX_DECK_TITLE_LENGTH,
  MAX_LYRICS_LENGTH,
} from "#shared";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../../lib/storage/db";
import { withQueryClient } from "../../test/queryClientFixture";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { SongPickerModal } from "./SongPickerModal";
import {
  getUserSongs,
  resetSongLibraryStore,
  saveSongToLibrary,
} from "./songLibraryStore";
import { __resetDeckSyncForTests } from "../../lib/sync/deckSync";
import { EDITOR_COPY } from "#copy/editor";

describe("SongPickerModal", () => {
  const onSelectSongMock = vi.fn();
  const onCloseMock = vi.fn();
  let api: FakeApi;

  function installServer() {
    api = installFakeApi({
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
    });
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

  it("검색어로 내 곡만 걸러 서버를 부르지 않는다", () => {
    const wish = seedMySong("소원");
    const other = seedMySong("은혜");
    renderPicker();
    fireEvent.change(screen.getByTestId("song-picker-search-input"), {
      target: { value: "소원" },
    });

    expect(screen.getByTestId(`song-item-${wish.id}`)).toBeInTheDocument();
    expect(
      screen.queryByTestId(`song-item-${other.id}`),
    ).not.toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("곡 항목은 키보드 Enter로도 고를 수 있다", () => {
    seedMySong("첫 곡");
    seedMySong("둘째 곡");
    renderPicker();

    const item = screen
      .getAllByRole("button", { pressed: false })
      .find((el) => el.dataset.testid?.startsWith("song-item-")) as HTMLElement;
    expect(item).toBeDefined();
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
  });

  describe("목록 화면에서 가사 불러오기", () => {
    const lyricsCalls = (): string[] =>
      api.calls
        .filter((call) => call.path.startsWith("/api/lyrics/"))
        .map((call) => call.path);

    function typeQuery(value: string) {
      fireEvent.change(screen.getByTestId("song-picker-search-input"), {
        target: { value },
      });
    }

    it("검색어가 비면 버튼이 막혀 있고, 검색어를 적는 동안에는 서버를 부르지 않는다", () => {
      renderPicker();
      const button = screen.getByTestId("song-picker-browse-import-btn");

      expect(button).toBeDisabled();
      typeQuery("은혜 위에 은혜");

      expect(button).toBeEnabled();
      expect(lyricsCalls()).toEqual([]);
    });

    it("검색어로 후보를 찾고, 고르면 가사를 채운 새 곡 폼에서 저장해 추가한다", async () => {
      renderPicker();
      typeQuery("은혜 위에 은혜");
      fireEvent.click(screen.getByTestId("song-picker-browse-import-btn"));

      fireEvent.click(
        await screen.findByRole("button", { name: "은혜 위에 은혜 · 해준" }),
      );

      await waitFor(() =>
        expect(
          screen.getByTestId("song-picker-create-lyrics-input"),
        ).toHaveValue("어두워진 나의 눈\n바라 볼 수 없네\n은혜 위에 은혜"),
      );
      expect(screen.getByTestId("song-picker-create-title-input")).toHaveValue(
        "은혜 위에 은혜",
      );
      expect(screen.getByTestId("song-picker-create-artist-input")).toHaveValue(
        "해준",
      );
      const search = api.calls.find((c) => c.path === "/api/lyrics/search");
      expect(new URLSearchParams(search?.search).get("title")).toBe(
        "은혜 위에 은혜",
      );

      fireEvent.click(screen.getByTestId("song-picker-create-submit-btn"));

      await waitFor(() => expect(onSelectSongMock).toHaveBeenCalledTimes(1));
      expect(onSelectSongMock.mock.calls[0][0]).toMatchObject({
        title: "은혜 위에 은혜",
        artist: "해준",
      });
    });

    it("보관함에 맞는 곡이 없으면 빈 상태에서도 불러올 수 있다", async () => {
      seedMySong();
      renderPicker();
      typeQuery("없는 노래");
      fireEvent.click(screen.getByTestId("song-picker-empty-import-btn"));

      expect(
        await screen.findByTestId("song-picker-lyrics-import-empty"),
      ).toHaveTextContent(EDITOR_COPY.lyricsImport.empty);
    });

    it("새 가사 입력으로 바로 가면 불러온 가사 없이 빈 폼을 연다", async () => {
      renderPicker();
      typeQuery("은혜 위에 은혜");
      fireEvent.click(screen.getByTestId("song-picker-browse-import-btn"));
      fireEvent.click(
        await screen.findByRole("button", { name: "은혜 위에 은혜 · 해준" }),
      );
      await screen.findByTestId("song-picker-create-lyrics-input");

      fireEvent.click(screen.getByTestId("song-picker-switch-create-btn"));
      fireEvent.click(screen.getByTestId("song-picker-switch-create-btn"));

      expect(screen.getByTestId("song-picker-create-lyrics-input")).toHaveValue(
        "",
      );
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
