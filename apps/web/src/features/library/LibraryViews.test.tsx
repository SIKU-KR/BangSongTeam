import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BackgroundLibraryView } from "./index";

describe("Library Views", () => {
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
        "apply-community-bg-mJIToShuKOc3FsbZIihi6",
      );
      fireEvent.click(applyBtn);
      expect(handleApply).toHaveBeenCalledWith("mJIToShuKOc3FsbZIihi6");
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
