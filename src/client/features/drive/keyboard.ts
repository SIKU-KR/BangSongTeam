/** 글자를 입력하는 중인지. 드라이브 단축키는 입력 중에는 동작하지 않는다 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/**
 * 버튼·링크·메뉴 항목처럼 Enter·Space를 스스로 처리하는 요소인지.
 * 목록 행(`role="option"`)은 여기에 들지 않는다.
 */
export function isControlTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest(
      'button, a[href], [role="button"], [role="menuitem"], [role="menu"]',
    ) !== null
  );
}

/**
 * 글자 단축키 판별. 한글 입력 상태에서는 `key`가 자모로 오므로 물리 키(`code`)도 본다.
 */
export function isLetterKey(event: KeyboardEvent, letter: string): boolean {
  return (
    event.code === `Key${letter.toUpperCase()}` ||
    event.key.toLowerCase() === letter.toLowerCase()
  );
}
