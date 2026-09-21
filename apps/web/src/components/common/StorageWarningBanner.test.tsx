import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { StorageWarningBanner } from "./StorageWarningBanner";
import {
  reportPersistenceError,
  clearPersistenceError,
  PersistenceUnavailableError,
} from "../../lib/storage";

describe("StorageWarningBanner", () => {
  beforeEach(() => {
    clearPersistenceError();
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
});
