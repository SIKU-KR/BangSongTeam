/**
 * 가사 수집 스크립트(`extractWorship.mjs`·`extractHymns.mjs`·`buildFixedJson.mjs`)가 함께 쓰는
 * 글 다듬기.
 */

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g;

function fromCodePoint(codePoint, entity) {
  const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
  return codePoint > 0x10ffff || isSurrogate
    ? entity
    : String.fromCodePoint(codePoint);
}

/**
 * HTML 엔티티(`&amp;`, `&#47504;`, `&#x41;`)를 글자로 바꾼다. 벅스 페이지의 메타 태그와 가사
 * `<xmp>`는 엔티티로 적혀 있어, 풀지 않으면 `Love &amp; Grace`가 그대로 공유 라이브러리 제목이
 * 된다.
 *
 * 한 번에 한 겹만 푼다. `&amp;lt;`는 `&lt;`라는 글자로 남는다. 모르는 이름과 글자가 될 수 없는
 * 코드는 그대로 둔다. `&nbsp;`는 가사의 띄어쓰기라 보통 공백으로 읽는다.
 */
export function decodeHtmlEntities(text) {
  return text.replace(ENTITY, (entity, decimal, hex, name) => {
    if (decimal !== undefined) {
      return fromCodePoint(Number.parseInt(decimal, 10), entity);
    }
    if (hex !== undefined) {
      return fromCodePoint(Number.parseInt(hex, 16), entity);
    }
    return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : entity;
  });
}

/**
 * 파일 이름에 쓸 수 없는 글자(`\ / : * ? " < > |`)를 `_`로 바꾼다. 바꾼 이름에서는 원래 글자를
 * 되살릴 수 없으므로, 곡 제목은 파일 이름이 아니라 수집한 JSON에서 읽는다(`buildFixedJson.mjs`).
 */
export function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

/** 워십 곡 가사 파일 이름 `[아티스트] 제목.txt` (`extractWorship.mjs`가 쓰고 이후 단계가 그대로 쓴다) */
export function worshipFileName({ artist, title }) {
  return `[${sanitizeFilename(artist || "Unknown")}] ${sanitizeFilename(title)}.txt`;
}
