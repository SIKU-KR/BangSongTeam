import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  MergedSlidesView,
  SongLibraryView,
  BackgroundLibraryView,
} from "./index";
import { mockSetlist } from "../presentation/mockSetlist";
import { COMMUNITY_SONGS } from "./mockCommunityData";

describe("Library Views", () => {
  describe("MergedSlidesView (합쳐진 슬라이드 단독 뷰)", () => {
    it("renders merged slides overview header with total counts and slides", () => {
      const handleOpenQuickPaste = vi.fn();

      render(
        <MemoryRouter>
          <MergedSlidesView
            setlist={mockSetlist}
            onOpenQuickPaste={handleOpenQuickPaste}
          />
        </MemoryRouter>,
      );

      // 헤더 정보
      expect(screen.getByText("통합 슬라이드")).toBeInTheDocument();
      expect(screen.getByText("2026 주일 3부 예배")).toBeInTheDocument();
      expect(screen.getByText("5곡 구성")).toBeInTheDocument();
      expect(screen.getByText(/총 23개 슬라이드/)).toBeInTheDocument();

      // 합쳐진 슬라이드 목록 타이틀
      expect(screen.getByText("합쳐진 슬라이드 전체 목록")).toBeInTheDocument();

      // 첫 번째 슬라이드 카드 확인 (#1)
      expect(screen.getByTestId("merged-slide-card-1")).toBeInTheDocument();
      expect(
        screen.getByText("시작됐네 우리 주님의 능력이 / 나의 삶을 다스리고 새롭게 하네"),
      ).toBeInTheDocument();

      // 버튼 동작
      const addBtn = screen.getByTestId("merged-open-quick-paste-btn");
      fireEvent.click(addBtn);
      expect(handleOpenQuickPaste).toHaveBeenCalled();
    });

    it("filters merged slides by lyrics search query", () => {
      render(
        <MemoryRouter>
          <MergedSlidesView
            setlist={mockSetlist}
            onOpenQuickPaste={vi.fn()}
            searchQuery="꽃들도"
          />
        </MemoryRouter>,
      );

      // '꽃들도' 곡의 슬라이드만 필터링되어 나타나야 함
      expect(
        screen.getAllByText(/꽃들도 구름도 바람도/).length,
      ).toBeGreaterThan(0);
      // '은혜로다' 가사는 없어야 함
      expect(
        screen.queryByText(/시작됐네 우리 주님의 능력이/),
      ).not.toBeInTheDocument();
    });
  });

  describe("SongLibraryView (곡 라이브러리: 2단락 구성)", () => {
    it("renders both '내가 등록한 곡' and '유저가 등록한 곡' sections", () => {
      const handleAddDeckToSetlist = vi.fn();
      const handleDuplicateSong = vi.fn();
      const handleRemoveSong = vi.fn();

      render(
        <MemoryRouter>
          <SongLibraryView
            setlist={mockSetlist}
            onOpenQuickPaste={vi.fn()}
            onAddDeckToSetlist={handleAddDeckToSetlist}
            onDuplicateSong={handleDuplicateSong}
            onRemoveSong={handleRemoveSong}
          />
        </MemoryRouter>,
      );

      // 단락 1: 내가 등록한 곡
      expect(screen.getByText("내가 등록한 곡")).toBeInTheDocument();
      expect(screen.getByText("은혜로다")).toBeInTheDocument();
      expect(screen.getByText("주 품에")).toBeInTheDocument();

      // 단락 2: 유저가 등록한 곡
      expect(screen.getByText("유저가 등록한 곡")).toBeInTheDocument();
      expect(screen.getByText("시간을 뚫고")).toBeInTheDocument();
      expect(screen.getByText("예수 늘 함께 계시네")).toBeInTheDocument();

      // 커뮤니티 곡 '내 콘티에 추가' 클릭
      const targetCommunityDeck = COMMUNITY_SONGS[0];
      const addBtn = screen.getByTestId(
        `add-community-song-${targetCommunityDeck.id}`,
      );
      fireEvent.click(addBtn);
      expect(handleAddDeckToSetlist).toHaveBeenCalledWith(targetCommunityDeck);
    });
  });

  describe("BackgroundLibraryView (배경 라이브러리: 2단락 구성)", () => {
    it("renders both '내가 등록한 배경' and '유저가 등록한 배경' sections", () => {
      const handleApply = vi.fn();

      render(
        <BackgroundLibraryView
          onApplyBackgroundToCurrentSet={handleApply}
        />,
      );

      // 단락 1: 내가 등록한 배경
      expect(screen.getByText("내가 등록한 배경")).toBeInTheDocument();
      expect(screen.getByText("우리 교회 본당 배경 01")).toBeInTheDocument();

      // 단락 2: 유저가 등록한 배경
      expect(screen.getByText("유저가 등록한 배경")).toBeInTheDocument();
      expect(screen.getByText("은은한 빛의 흐름")).toBeInTheDocument();
      expect(screen.getByText("고요한 호수 물결")).toBeInTheDocument();

      // 태그 필터 동작
      const warmFilter = screen.getByRole("button", { name: "따뜻한" });
      fireEvent.click(warmFilter);

      // 배경 적용 클릭
      const applyBtn = screen.getByTestId(
        "apply-community-bg-b0000000-0000-0000-0000-000000000001",
      );
      fireEvent.click(applyBtn);
      expect(handleApply).toHaveBeenCalledWith(
        "b0000000-0000-0000-0000-000000000001",
      );
    });

    it("can register a new custom background", () => {
      render(<BackgroundLibraryView />);

      const openRegisterBtn = screen.getByTestId("register-custom-bg-btn");
      fireEvent.click(openRegisterBtn);

      expect(screen.getByText("새 배경 영상 등록")).toBeInTheDocument();

      const titleInput = screen.getByPlaceholderText(
        "예: 우리 교회 메인 비디오 루프",
      );
      fireEvent.change(titleInput, { target: { value: "새벽기도 배경" } });

      const submitBtn = screen.getByRole("button", { name: "등록하기" });
      act(() => {
        fireEvent.click(submitBtn);
      });

      expect(screen.getByText("새벽기도 배경")).toBeInTheDocument();
    });
  });
});
