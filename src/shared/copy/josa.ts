const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

function finalConsonant(text: string): number | null {
  const trimmed = text.replace(/[’'"」』)\]\s]+$/u, "");
  const code = trimmed.charCodeAt(trimmed.length - 1);
  if (Number.isNaN(code) || code < HANGUL_START || code > HANGUL_END) {
    return null;
  }
  return (code - HANGUL_START) % 28;
}

/** "폴더를" / "찬양을" / "Youth을(를)" */
export function withObjectParticle(text: string): string {
  const jong = finalConsonant(text);
  if (jong === null) return `${text}을(를)`;
  return `${text}${jong === 0 ? "를" : "을"}`;
}

/** "주일로" / "청년부로" / "2026(으)로" (받침 ㄹ은 '로') */
export function withDirectionParticle(text: string): string {
  const jong = finalConsonant(text);
  if (jong === null) return `${text}(으)로`;
  return `${text}${jong === 0 || jong === 8 ? "로" : "으로"}`;
}
