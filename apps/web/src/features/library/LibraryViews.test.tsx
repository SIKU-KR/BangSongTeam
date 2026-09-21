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
  describe("MergedSlidesView (통합슬라이드 1개 단위 뷰)", () => {
    it("renders merged slide deck presentation card as single unit", () => {
      const handleOpenQuickPaste = vi.fn();
      const handleCreateNew = vi.fn();

      render(
        <MemoryRouter>
          <MergedSlidesView
            setlist={mockSetlist}
            onOpenQuickPaste={handleOpenQuickPaste}
            onCreateNewPresentation={handleCreateNew}
          />
        </MemoryRouter>,
      );

      // 섹션 헤더
      expect(screen.getByText("통합 슬라이드 프레젠테이션")).toBeInTheDocument();
      expect(screen.getByText("1개 프레젠테이션 덱")).toBeInTheDocument();

      // 통합 슬라이드 1개 단위 카드
      expect(screen.getByTestId("presentation-card")).toBeInTheDocument();
      expect(screen.getByText("2026 주일 3부 예배")).toBeInTheDocument();
      expect(screen.getByText("5곡 세트")).toBeInTheDocument();
      expect(screen.getByText("23 슬라이드")).toBeInTheDocument();

      // 버튼 동작
      expect(screen.getByTestId("merged-start-present-btn")).toBeInTheDocument();
      expect(screen.getByText("통합 슬라이드에 곡 추가")).toBeInTheDocument();
      expect(screen.getByText("새 통합 프레젠테이션 생성")).toBeInTheDocument();
    });

    it("displays empty search message when query does not match setlist", () => {
      render(
        <MemoryRouter>
          <MergedSlidesView
            setlist={mockSetlist}
            onOpenQuickPaste={vi.fn()}
            onCreateNewPresentation={vi.fn()}
            searchQuery="전혀일치하지않는검색어"
          />
        </MemoryRouter>,
      );

      expect(
        screen.getByText(/"전혀일치하지않는검색어"에 일치하는 통합 프레젠테이션이 없습니다./),
      ).toBeInTheDocument();
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
