import { disassemble, getChoseong, convertQwertyToHangul } from "es-hangul";

/**
 * 한글 검색 대상 문자열 하나를 검색에 맞게 풀어 둔 꼴.
 *
 * 자모 분해와 초성 추출은 글자 수에 비례해 비싸다. 같은 대상을 검색어 글자마다 다시 풀지 않게,
 * 풀어 낸 결과는 처음 쓸 때 한 번만 만들어 둔다. 글자 그대로 들어 있어 첫 비교에서 찾아지는
 * 대상은 풀지 않는다.
 */
export interface HangulTarget {
  readonly source: string;
  readonly lower: string;
  readonly disassembled: string;
  readonly choseong: string;
  readonly choseongNoSpace: string;
}

export function prepareHangulTarget(
  text: string | null | undefined,
): HangulTarget {
  const source = text ?? "";
  const lower = source.toLowerCase();
  let disassembled: string | undefined;
  let choseong: string | undefined;
  let choseongNoSpace: string | undefined;
  return {
    source,
    lower,
    get disassembled() {
      return (disassembled ??= disassemble(lower));
    },
    get choseong() {
      return (choseong ??= getChoseong(lower));
    },
    get choseongNoSpace() {
      return (choseongNoSpace ??= this.choseong.replace(/\s+/g, ""));
    },
  };
}

interface QueryForms {
  clean: string;
  disassembled: string;
  noSpace: string;
  converted: { text: string; disassembled: string } | null;
}

let lastQuery: { raw: string; forms: QueryForms } | null = null;

/**
 * 검색어를 비교에 쓰는 꼴로 푼다. 한 번 검색하는 동안 모든 대상이 같은 검색어를 쓰므로 마지막
 * 검색어의 결과만 기억해 대상마다 다시 풀지 않는다.
 */
function queryFormsOf(query: string): QueryForms {
  if (lastQuery?.raw === query) return lastQuery.forms;
  const clean = query.trim().toLowerCase();
  let converted: QueryForms["converted"] = null;
  try {
    const text = convertQwertyToHangul(clean);
    if (text && text !== clean) {
      converted = { text, disassembled: disassemble(text) };
    }
  } catch (error) {
    void error;
  }
  const forms: QueryForms = {
    clean,
    disassembled: disassemble(clean),
    noSpace: clean.replace(/\s+/g, ""),
    converted,
  };
  lastQuery = { raw: query, forms };
  return forms;
}

/**
 * 풀어 둔 대상이 검색어에 맞는지. 초성·자모 분해 및 영타 오타 변환을 지원한다.
 * 빈 검색어는 모두 통과하고, 빈 대상은 어떤 검색어도 통과하지 못한다.
 */
export function hangulIncludesPrepared(
  target: HangulTarget,
  query: string,
): boolean {
  if (!query || !query.trim()) return true;
  if (!target.source) return false;

  const { clean, disassembled, noSpace, converted } = queryFormsOf(query);

  if (target.lower.includes(clean)) return true;
  if (target.disassembled.includes(disassembled)) return true;
  if (target.choseong.includes(clean)) return true;
  if (noSpace && target.choseongNoSpace.includes(noSpace)) return true;

  if (converted) {
    if (target.lower.includes(converted.text)) return true;
    if (target.disassembled.includes(converted.disassembled)) return true;
    if (target.choseong.includes(converted.text)) return true;
  }

  return false;
}

/**
 * 초성·자모 분해 및 영타 오타 변환을 지원하는 한글 검색 일치 여부를 판별한다.
 * 같은 대상을 거듭 검색한다면 `prepareHangulTarget`으로 한 번 풀어 두고 쓴다.
 */
export function hangulIncludes(
  target: string | null | undefined,
  query: string,
): boolean {
  return hangulIncludesPrepared(prepareHangulTarget(target), query);
}
