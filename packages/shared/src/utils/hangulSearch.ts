import { disassemble, getChoseong, convertQwertyToHangul } from "es-hangul";

/**
 * es-hangul 기반 스마트 한글 검색 유틸리티
 *
 * 지원 기능:
 * 1. 일반 부분 일치 (대소문자 무시)
 * 2. 초성 검색: 'ㅇㅎㄹㄷ' -> '은혜로다', 'ㅅㅅ' -> '시선', 'ㄲㄷㄷ' -> '꽃들도'
 * 3. 자모 분해 검색: 타이핑 중인 미완성 자모 지원 ('은ㅎ' -> '은혜', 'ㅅㅣ' -> '시선')
 * 4. 띄어쓰기 무시 초성 검색: 'ㅅㄱㅇㄸㄱ' -> '시간을 뚫고'
 * 5. 영타(QWERTY) 오타 자동 한글 변환 검색: 한/영 키 전환을 깜빡하고 입력한 경우 자동 매칭
 *
 * @param target 검색 대상 문자열 (제목, 가사, 아티스트 등)
 * @param query 사용자가 입력한 검색어
 * @returns 매칭 여부
 */
export function hangulIncludes(
  target: string | null | undefined,
  query: string,
): boolean {
  if (!query || !query.trim()) return true;
  if (!target) return false;

  const cleanQuery = query.trim().toLowerCase();
  const cleanTarget = target.toLowerCase();

  // 1. 일반 부분 문자열 일치
  if (cleanTarget.includes(cleanQuery)) {
    return true;
  }

  // 2. 자모 분해 일치 (자모 단위 매칭, 미완성 음절 포함)
  const targetDisassembled = disassemble(cleanTarget);
  const queryDisassembled = disassemble(cleanQuery);
  if (targetDisassembled.includes(queryDisassembled)) {
    return true;
  }

  // 3. 초성 일치 (초성 검색 지원)
  const targetChoseong = getChoseong(cleanTarget);
  if (targetChoseong.includes(cleanQuery)) {
    return true;
  }

  // 공백 제거 초성 매칭 (e.g. '시간을 뚫고' vs 'ㅅㄱㅇㄸㄱ')
  const targetChoseongNoSpace = targetChoseong.replace(/\s+/g, "");
  const queryNoSpace = cleanQuery.replace(/\s+/g, "");
  if (queryNoSpace && targetChoseongNoSpace.includes(queryNoSpace)) {
    return true;
  }

  // 4. 영타 오타 한글 변환 매칭
  try {
    const convertedHangul = convertQwertyToHangul(cleanQuery);
    if (convertedHangul && convertedHangul !== cleanQuery) {
      if (cleanTarget.includes(convertedHangul)) return true;
      if (targetDisassembled.includes(disassemble(convertedHangul))) return true;
      if (targetChoseong.includes(convertedHangul)) return true;
    }
  } catch {
    // ignore
  }

  return false;
}
