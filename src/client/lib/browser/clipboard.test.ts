import { describe, it, expect, vi, afterEach } from "vitest";
import { copyToClipboard } from "./clipboard";

function setClipboard(clipboard: unknown): void {
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
}

function setExecCommand(result: boolean): ReturnType<typeof vi.fn> {
  const execCommand = vi.fn(() => result);
  Object.defineProperty(document, "execCommand", {
    value: execCommand,
    configurable: true,
    writable: true,
  });
  return execCommand;
}

describe("copyToClipboard", () => {
  afterEach(() => {
    setClipboard(undefined);
  });

  it("Clipboard API가 있으면 그것으로 복사한다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const execCommand = setExecCommand(true);

    await copyToClipboard("가사");

    expect(writeText).toHaveBeenCalledWith("가사");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("Clipboard API가 없으면 선택 영역 복사로 폴백하고 임시 요소를 지운다", async () => {
    setClipboard(undefined);
    const execCommand = setExecCommand(true);

    await copyToClipboard("링크");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("Clipboard API가 거절하면 선택 영역 복사로 한 번 더 시도한다", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    const execCommand = setExecCommand(true);

    await copyToClipboard("링크");

    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("두 방법이 모두 실패하면 throw한다", async () => {
    setClipboard(undefined);
    setExecCommand(false);

    await expect(copyToClipboard("링크")).rejects.toThrow();
  });
});
