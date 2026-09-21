import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  MergedSlidesView,
  SongLibraryView,
  BackgroundLibraryView,
} from "./index";
import { mockPresentation } from "../presentation/mockPresentation";
import { COMMUNITY_SONGS } from "./mockCommunityData";

describe("Library Views", () => {
  describe("MergedSlidesView (프레젠테이션 1개 단위 뷰)", () => {
    it("renders slide deck presentation card as single unit", () => {
      const handleCreateNew = vi.fn();

      render(
        <MemoryRouter>
          <MergedSlidesView
            presentation={mockPresentation}
            onCreateNewPresentation={handleCreateNew}
          />
        </MemoryRouter>,
      );

      // 프레젠테이션 1개 단위 카드
      expect(screen.getByTestId("presentation-card")).toBeInTheDocument();
      expect(screen.getByText("2026 주일 3부 예배")).toBeInTheDocument();
      expect(screen.getByText("5곡 세트")).toBeInTheDocument();
      expect(screen.getByText("23 슬라이드")).toBeInTheDocument();

      // 새 프레젠테이션 카드
      expect(screen.getByText("새 프레젠테이션 생성")).toBeInTheDocument();
    });

    it("displays empty search message when query does not match presentation", () => {
      render(
        <MemoryRouter>
          <MergedSlidesView
            presentation={mockPresentation}
            onCreateNewPresentation={vi.fn()}
            searchQuery="전혀일치하지않는검색어"
          />
        </MemoryRouter>,
      );

      expect(
        screen.getByText(
          /"전혀일치하지않는검색어"에 일치하는 프레젠테이션이 없습니다./,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("SongLibraryView (곡 라이브러리: 2단락 구성)", () => {
    it("renders both '내가 등록한 곡' and '유저가 등록한 곡' sections", () => {
      const handleAddDeckToPresentation = vi.fn();
      const handleDuplicateSong = vi.fn();
      const handleRemoveSong = vi.fn();

      render(
        <MemoryRouter>
          <SongLibraryView
            presentation={mockPresentation}
            onOpenQuickPaste={vi.fn()}
            onAddDeckToPresentation={handleAddDeckToPresentation}
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

      // 커뮤니티 곡 '내 프레젠테이션에 추가' 클릭
      const targetCommunityDeck = COMMUNITY_SONGS[0];
      const addBtn = screen.getByTestId(
        `add-community-song-${targetCommunityDeck.id}`,
      );
      fireEvent.click(addBtn);
      expect(handleAddDeckToPresentation).toHaveBeenCalledWith(
        targetCommunityDeck,
      );
    });
  });

  describe("BackgroundLibraryView (배경 라이브러리: 2단락 구성)", () => {
    it("renders both '내가 등록한 배경' and '유저가 등록한 배경' sections", () => {
      const handleApply = vi.fn();

      render(
        <BackgroundLibraryView onApplyBackgroundToCurrentSet={handleApply} />,
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

      const titleInput =
        screen.getByPlaceholderText("예: 우리 교회 메인 비디오 루프");
      fireEvent.change(titleInput, { target: { value: "새벽기도 배경" } });

      const submitBtn = screen.getByRole("button", { name: "등록하기" });
      act(() => {
        fireEvent.click(submitBtn);
      });

      expect(screen.getByText("새벽기도 배경")).toBeInTheDocument();
    });

    it("supports es-hangul choseong search for backgrounds", () => {
      render(
        <BackgroundLibraryView
          searchQuery="ㅂㄷ" // '본당' 초성
        />,
      );

      // '본당' 태그를 가진 '우리 교회 본당 배경 01' 매칭 확인
      expect(screen.getByText("우리 교회 본당 배경 01")).toBeInTheDocument();
    });
  });

  describe("es-hangul Korean Search Integration", () => {
    it("filters songs by Korean choseong (초성 검색)", () => {
      render(
        <MemoryRouter>
          <SongLibraryView
            presentation={mockPresentation}
            onOpenQuickPaste={vi.fn()}
            onAddDeckToPresentation={vi.fn()}
            onDuplicateSong={vi.fn()}
            onRemoveSong={vi.fn()}
            searchQuery="ㅇㅎㄹㄷ" // '은혜로다' 초성
          />
        </MemoryRouter>,
      );

      expect(screen.getByText("은혜로다")).toBeInTheDocument();
      expect(screen.queryByText("주 품에")).not.toBeInTheDocument();
    });

    it("filters songs by disassembled typing (실시간 미완성 자모 검색)", () => {
      render(
        <MemoryRouter>
          <SongLibraryView
            presentation={mockPresentation}
            onOpenQuickPaste={vi.fn()}
            onAddDeckToPresentation={vi.fn()}
            onDuplicateSong={vi.fn()}
            onRemoveSong={vi.fn()}
            searchQuery="시ㅅ" // '시선' 타이핑 중
          />
        </MemoryRouter>,
      );

      expect(screen.getByText("시선")).toBeInTheDocument();
      expect(screen.queryByText("주 품에")).not.toBeInTheDocument();
    });
  });
});
