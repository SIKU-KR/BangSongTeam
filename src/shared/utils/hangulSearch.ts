import { disassemble, getChoseong, convertQwertyToHangul } from "es-hangul";

/**
 * 초성·자모 분해 및 영타 오타 변환을 지원하는 한글 검색 일치 여부를 판별한다.
 */
export function hangulIncludes(
  target: string | null | undefined,
  query: string,
): boolean {
  if (!query || !query.trim()) return true;
  if (!target) return false;

  const cleanQuery = query.trim().toLowerCase();
  const cleanTarget = target.toLowerCase();

  if (cleanTarget.includes(cleanQuery)) {
    return true;
  }

  const targetDisassembled = disassemble(cleanTarget);
  const queryDisassembled = disassemble(cleanQuery);
  if (targetDisassembled.includes(queryDisassembled)) {
    return true;
  }

  const targetChoseong = getChoseong(cleanTarget);
  if (targetChoseong.includes(cleanQuery)) {
    return true;
  }

  const targetChoseongNoSpace = targetChoseong.replace(/\s+/g, "");
  const queryNoSpace = cleanQuery.replace(/\s+/g, "");
  if (queryNoSpace && targetChoseongNoSpace.includes(queryNoSpace)) {
    return true;
  }

  try {
    const convertedHangul = convertQwertyToHangul(cleanQuery);
    if (convertedHangul && convertedHangul !== cleanQuery) {
      if (cleanTarget.includes(convertedHangul)) return true;
      if (targetDisassembled.includes(disassemble(convertedHangul)))
        return true;
      if (targetChoseong.includes(convertedHangul)) return true;
    }
  } catch (error) {
    void error;
  }

  return false;
}
