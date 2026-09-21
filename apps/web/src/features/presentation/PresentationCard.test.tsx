import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PresentationCard } from "./PresentationCard";
import { mockDecks, mockSetlist } from "./mockSetlist";

describe("PresentationCard", () => {
  it("should render 16:9 badge, title, and slide count for a single deck", () => {
    const deck = mockDecks[0];
    const onPresent = vi.fn();
    const onEdit = vi.fn();

    render(
      <PresentationCard deck={deck} onPresent={onPresent} onEdit={onEdit} />,
    );

    expect(screen.getByText("은혜로다")).toBeInTheDocument();
    expect(screen.getByText("16:9")).toBeInTheDocument();
    expect(screen.getByText(/5 슬라이드/)).toBeInTheDocument();
    expect(screen.getByText("손경민")).toBeInTheDocument();
  });

  it("should trigger onPresent and onEdit callbacks", () => {
    const deck = mockDecks[0];
    const onPresent = vi.fn();
    const onEdit = vi.fn();

    render(
      <PresentationCard deck={deck} onPresent={onPresent} onEdit={onEdit} />,
    );

    const presentBtn = screen.getByTestId("card-present-btn");
    fireEvent.click(presentBtn);
    expect(onPresent).toHaveBeenCalledTimes(1);

    const editBtn = screen.getByTestId("card-edit-btn");
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("should render setlist summary when setlist prop is passed", () => {
    const onPresent = vi.fn();
    const onEdit = vi.fn();

    render(
      <PresentationCard
        setlist={mockSetlist}
        onPresent={onPresent}
        onEdit={onEdit}
      />,
    );

    expect(screen.getByText("2026 주일 3부 예배")).toBeInTheDocument();
    expect(screen.getByText("5곡 세트")).toBeInTheDocument();
  });
});
