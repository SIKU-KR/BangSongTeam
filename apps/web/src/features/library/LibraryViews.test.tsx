import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MergedSlidesView, BackgroundLibraryView } from "./index";
import { mockPresentation } from "../presentation/mockPresentation";
import { SEED_PRESENTATIONS } from "../presentation/mockPresentations";

describe("Library Views", () => {
  describe("MergedSlidesView (프레젠테이션 1개 단위 뷰)", () => {
    it("renders slide deck presentation card as single unit", () => {
      const handleCreateNew = vi.fn();

      render(
        <MemoryRouter>
          <MergedSlidesView
            presentations={[mockPresentation]}
            onOpenPresentation={vi.fn()}
            onStartPresentation={vi.fn()}
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

    it("여러 프레젠테이션을 렌더하고 클릭 시 해당 id로 onOpenPresentation을 호출한다", async () => {
      const handleOpen = vi.fn();

      render(
        <MemoryRouter>
          <MergedSlidesView
            presentations={SEED_PRESENTATIONS}
            onOpenPresentation={handleOpen}
            onStartPresentation={vi.fn()}
            onCreateNewPresentation={vi.fn()}
          />
        </MemoryRouter>,
      );

      // 두 번째 시드 문서(기본 recent 정렬에서 mockPresentation 다음)
      const second = SEED_PRESENTATIONS[1];
      const cards = screen.getAllByText(second.title);
      fireEvent.click(cards[0]);

      expect(handleOpen).toHaveBeenCalledWith(second.id);
    });

    it("displays empty search message when query does not match presentation", () => {
      render(
        <MemoryRouter>
          <MergedSlidesView
            presentations={[mockPresentation]}
            onOpenPresentation={vi.fn()}
            onStartPresentation={vi.fn()}
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
});
