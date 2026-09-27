import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { signOut } from "../../lib/auth";
import { signInAsTestUser } from "../../test/sessionFixture";
import { withQueryClient } from "../../test/queryClientFixture";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { ConsentGate } from "./ConsentGate";

vi.mock("../../lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/auth")>()),
  signOut: vi.fn(async () => undefined),
}));

function renderGate(path = "/presentations"): void {
  render(
    withQueryClient(
      <MemoryRouter initialEntries={[path]}>
        <ConsentGate />
      </MemoryRouter>,
    ),
  );
}

describe("ConsentGate (가입 동의 모달)", () => {
  let api: FakeApi;
  let agreedAt: string | null;

  beforeEach(() => {
    vi.mocked(signOut).mockClear();
    signInAsTestUser();
    agreedAt = null;
    api = installFakeApi({
      "GET /api/consent": () => ({ body: { agreedAt } }),
      "POST /api/consent": () => {
        agreedAt = "2026-09-27T00:00:00.000Z";
        return { body: { agreedAt } };
      },
    });
  });

  afterEach(() => api.restore());

  it("동의하지 않은 사용자에게 모달을 띄우고, 필수 항목을 모두 체크해야 동의할 수 있다", async () => {
    renderGate();

    expect(await screen.findByTestId("consent-dialog")).toBeInTheDocument();
    const agree = screen.getByTestId("consent-agree");
    expect(agree).toBeDisabled();

    fireEvent.click(screen.getByTestId("consent-ageOver14"));
    fireEvent.click(screen.getByTestId("consent-terms"));
    expect(agree).toBeDisabled();

    fireEvent.click(screen.getByTestId("consent-privacy"));
    expect(agree).toBeEnabled();
  });

  it("전체 동의 후 동의하면 기록하고 모달을 닫는다", async () => {
    renderGate();

    fireEvent.click(await screen.findByTestId("consent-all"));
    fireEvent.click(screen.getByTestId("consent-agree"));

    await waitFor(() =>
      expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument(),
    );
    expect(api.calls).toContainEqual(
      expect.objectContaining({
        method: "POST",
        path: "/api/consent",
        body: { ageOver14: true, terms: true, privacy: true },
      }),
    );
  });

  it("이미 동의한 사용자에게는 띄우지 않는다", async () => {
    agreedAt = "2026-09-01T00:00:00.000Z";
    renderGate();

    await waitFor(() =>
      expect(api.calls.some((call) => call.path === "/api/consent")).toBe(true),
    );
    expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument();
  });

  it.each(["/present/p1/fullscreen", "/terms", "/privacy"])(
    "%s에서는 동의 상태를 묻지 않는다",
    (path) => {
      renderGate(path);
      expect(api.calls).toHaveLength(0);
      expect(screen.queryByTestId("consent-dialog")).not.toBeInTheDocument();
    },
  );

  it("동의하지 않음을 누르면 로그아웃한다", async () => {
    renderGate();

    fireEvent.click(await screen.findByTestId("consent-decline"));

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
