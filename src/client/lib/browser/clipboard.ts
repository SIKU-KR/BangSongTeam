function copyWithSelection(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  try {
    textarea.select();
    // 비보안 컨텍스트(LAN IP 접속 등)에는 navigator.clipboard가 없어 폐기 예정 API로 폴백한다.
    // https://developer.mozilla.org/docs/Web/API/Clipboard_API#security_considerations
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    previousFocus?.focus();
  }
}

/**
 * 텍스트를 클립보드에 복사한다. 실패하면 throw한다.
 *
 * 비동기 Clipboard API가 있으면 먼저 쓰고, 없거나 거절되면(비보안 컨텍스트,
 * 권한 거부) 선택 영역 복사로 한 번 더 시도한다.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      if (typeof document === "undefined") throw new Error("clipboard");
    }
  }
  if (typeof document === "undefined" || !copyWithSelection(text)) {
    throw new Error("clipboard");
  }
}
