import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { SEED_PRESENTATIONS } from "../presentation";
import {
  usePresentationFontsReady,
  FONT_READY_TIMEOUT_MS,
} from "./usePresentationFontsReady";

const { warmPresentationFonts } = vi.hoisted(() => ({
  warmPresentationFonts: vi.fn<() => Promise<void>>(),
}));

vi.mock("../../lib/offline", () => ({ warmPresentationFonts }));

const PRESENTATION = SEED_PRESENTATIONS[0];

beforeEach(() => {
  vi.useFakeTimers();
  warmPresentationFonts.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePresentationFontsReady", () => {
  it("지연 없이 세트 글꼴을 불러오고, 끝나면 준비됐다고 알린다", async () => {
    let finish: () => void = () => undefined;
    warmPresentationFonts.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );

    const { result } = renderHook(() =>
      usePresentationFontsReady(PRESENTATION),
    );

    expect(warmPresentationFonts).toHaveBeenCalledWith(PRESENTATION);
    expect(result.current).toBe(false);

    await act(async () => {
      finish();
    });

    expect(result.current).toBe(true);
  });

  it("글꼴이 늦으면 제한 시간 뒤에 준비됐다고 본다", () => {
    warmPresentationFonts.mockReturnValue(new Promise<void>(() => undefined));

    const { result } = renderHook(() =>
      usePresentationFontsReady(PRESENTATION),
    );

    act(() => {
      vi.advanceTimersByTime(FONT_READY_TIMEOUT_MS - 1);
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  it("글꼴을 받지 못해도 가사를 막지 않는다", async () => {
    warmPresentationFonts.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() =>
      usePresentationFontsReady(PRESENTATION),
    );
    await act(async () => undefined);

    expect(result.current).toBe(true);
  });

  it("세트가 없으면 부르지 않는다", () => {
    const { result } = renderHook(() => usePresentationFontsReady(null));

    act(() => {
      vi.advanceTimersByTime(FONT_READY_TIMEOUT_MS);
    });

    expect(warmPresentationFonts).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });
});
