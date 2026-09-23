import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import React from "react";
import { QuickLyricPasteModal } from "./QuickLyricPasteModal";
import { DeckSchema } from "@repo/shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import { SEED_USER_ID } from "../presentation";

describe("QuickLyricPasteModal (Task 3.2)", () => {
  // 곡의 주인은 세션 사용자다. 로그인 없이는 곡을 만들 수 없다.
  beforeEach(() => {
    signInAsTestUser();
  });

  it("isOpen이 false이면 모달이 렌더링되지 않아야 한다", () => {
    const { container } = render(
      <QuickLyricPasteModal
        isOpen={false}
        onClose={vi.fn()}
        onAddToSet={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("isOpen이 true이면 제목 입력란, 가사 textarea, 세트에 추가 버튼이 렌더링되어야 한다", () => {
    render(
      <QuickLyricPasteModal
        isOpen={true}
        onClose={vi.fn()}
        onAddToSet={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/곡 제목/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/가사/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "세트에 추가" }),
    ).toBeInTheDocument();
  });

  it("가사를 textarea에 입력하면 실시간으로 슬라이드 카드와 줄 수가 렌더링되어야 한다", () => {
    render(
      <QuickLyricPasteModal
        isOpen={true}
        onClose={vi.fn()}
        onAddToSet={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText(/가사/);
    const sampleLyrics =
      "은혜로다 주의 은혜\n한량없는 주의 은혜\n\n나의 모든 것 주께 맡기며\n주의 음성에 순종하리";

    fireEvent.change(textarea, { target: { value: sampleLyrics } });

    // 2개의 슬라이드 카드가 표시되어야 함
    const slideCards = screen.getAllByTestId("slide-preview-card");
    expect(slideCards).toHaveLength(2);

    expect(screen.getByText("슬라이드 1")).toBeInTheDocument();
    expect(screen.getByText("슬라이드 2")).toBeInTheDocument();
    // 줄 수 표시 (각각 2줄)
    expect(screen.getAllByText(/2줄/)).toHaveLength(2);
    expect(
      within(slideCards[0]).getByText("한량없는 주의 은혜"),
    ).toBeInTheDocument();
  });

  it("제목이나 가사가 입력되지 않았을 때는 '세트에 추가' 버튼이 비활성화되어야 한다", () => {
    render(
      <QuickLyricPasteModal
        isOpen={true}
        onClose={vi.fn()}
        onAddToSet={vi.fn()}
      />,
    );

    const submitBtn = screen.getByRole("button", { name: "세트에 추가" });
    expect(submitBtn).toBeDisabled();

    // 제목만 입력한 경우
    const titleInput = screen.getByPlaceholderText(/곡 제목/);
    fireEvent.change(titleInput, { target: { value: "은혜로다" } });
    expect(submitBtn).toBeDisabled();

    // 가사도 입력하면 활성화됨
    const textarea = screen.getByPlaceholderText(/가사/);
    fireEvent.change(textarea, {
      target: { value: "시작됐네 우리 주님의 능력이" },
    });
    expect(submitBtn).toBeEnabled();
  });

  it("'세트에 추가' 클릭 시 유효한 Deck 객체와 함께 onAddToSet 및 onClose가 호출되어야 한다", () => {
    const handleAddToSet = vi.fn();
    const handleClose = vi.fn();

    render(
      <QuickLyricPasteModal
        isOpen={true}
        onClose={handleClose}
        onAddToSet={handleAddToSet}
      />,
    );

    const titleInput = screen.getByPlaceholderText(/곡 제목/);
    const artistInput = screen.getByPlaceholderText(/아티스트/);
    const textarea = screen.getByPlaceholderText(/가사/);

    fireEvent.change(titleInput, { target: { value: "은혜로다" } });
    fireEvent.change(artistInput, { target: { value: "손경민" } });
    fireEvent.change(textarea, {
      target: { value: "은혜로다 주의 은혜\n한량없는 주의 은혜" },
    });

    const submitBtn = screen.getByRole("button", { name: "세트에 추가" });
    fireEvent.click(submitBtn);

    expect(handleAddToSet).toHaveBeenCalledTimes(1);
    const createdDeck = handleAddToSet.mock.calls[0][0];

    // DeckSchema 정합성 검증
    expect(() => DeckSchema.parse(createdDeck)).not.toThrow();
    // 하드코딩된 게스트 uuid가 아니라 세션 사용자가 주인이어야 한다.
    expect(createdDeck.userId).toBe(SEED_USER_ID);
    expect(createdDeck.title).toBe("은혜로다");
    expect(createdDeck.artist).toBe("손경민");
    expect(createdDeck.slides).toHaveLength(1);
    expect(createdDeck.slides[0].lines).toHaveLength(2);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("취소 버튼 클릭 시 onClose가 호출되어야 한다", () => {
    const handleClose = vi.fn();

    render(
      <QuickLyricPasteModal
        isOpen={true}
        onClose={handleClose}
        onAddToSet={vi.fn()}
      />,
    );

    const cancelBtn = screen.getByRole("button", { name: "취소" });
    fireEvent.click(cancelBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("곡 제목을 입력하면 모달 내 멜론/벅스 검색 링크가 실시간으로 연동되어야 한다", () => {
    render(
      <QuickLyricPasteModal
        isOpen={true}
        onClose={vi.fn()}
        onAddToSet={vi.fn()}
      />,
    );

    const titleInput = screen.getByPlaceholderText(/곡 제목/);
    fireEvent.change(titleInput, { target: { value: "시선" } });

    const melonLink = screen.getByRole("link", { name: /멜론/ });
    const bugsLink = screen.getByRole("link", { name: /벅스/ });

    expect(melonLink).toHaveAttribute(
      "href",
      "https://www.melon.com/search/total/index.htm?q=%EC%8B%9C%EC%84%A0",
    );
    expect(bugsLink).toHaveAttribute(
      "href",
      "https://music.bugs.co.kr/search/integrated?q=%EC%8B%9C%EC%84%A0",
    );
  });
});
