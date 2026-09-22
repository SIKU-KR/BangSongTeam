import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { StorageWarningBanner } from "./StorageWarningBanner";
import {
  reportPersistenceError,
  clearPersistenceError,
  reportCorruptedRecords,
  clearCorruptedRecords,
  PersistenceUnavailableError,
} from "../../lib/storage";

describe("StorageWarningBanner", () => {
  beforeEach(() => {
    clearPersistenceError();
    clearCorruptedRecords();
  });

  it("저장 오류가 없으면 아무것도 렌더링하지 않는다", () => {
    render(<StorageWarningBanner />);

    expect(
      screen.queryByTestId("storage-warning-banner"),
    ).not.toBeInTheDocument();
  });

  it("IndexedDB를 쓸 수 없으면 해당 안내를 띄운다", () => {
    reportPersistenceError(new PersistenceUnavailableError());
    render(<StorageWarningBanner />);

    expect(screen.getByTestId("storage-warning-banner")).toHaveTextContent(
      /저장할 수 없습니다/,
    );
  });

  it("용량 초과는 별도 문구로 구분한다", () => {
    reportPersistenceError(new DOMException("quota", "QuotaExceededError"));
    render(<StorageWarningBanner />);

    expect(screen.getByTestId("storage-warning-banner")).toHaveTextContent(
      /저장 공간이 가득/,
    );
  });

  it("닫기 버튼을 제공하지 않는다 (해소될 때까지 계속 보여야 한다)", () => {
    reportPersistenceError(new Error("boom"));
    render(<StorageWarningBanner />);

    expect(screen.getByTestId("storage-warning-banner")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("읽지 못한 저장본이 있으면 격리 안내를 띄운다", () => {
    reportCorruptedRecords([
      { id: "p1", reason: "invalid uuid" },
      { id: "p2", reason: "invalid uuid" },
    ]);
    render(<StorageWarningBanner />);

    const banner = screen.getByTestId("corrupted-warning-banner");
    expect(banner).toHaveTextContent(/2개/);
    expect(banner).toHaveTextContent(/열지 못했습니다/);
  });

  it("격리 안내는 저장이 다시 성공해도 사라지지 않는다", () => {
    reportCorruptedRecords([{ id: "p1", reason: "invalid uuid" }]);
    clearPersistenceError();
    render(<StorageWarningBanner />);

    expect(screen.getByTestId("corrupted-warning-banner")).toBeInTheDocument();
  });

  it("격리된 저장본이 없으면 격리 안내를 렌더링하지 않는다", () => {
    reportCorruptedRecords([]);
    render(<StorageWarningBanner />);

    expect(
      screen.queryByTestId("corrupted-warning-banner"),
    ).not.toBeInTheDocument();
  });
});
