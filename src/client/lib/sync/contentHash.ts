/**
 * 글을 53비트 해시(cyrb53)로 줄여 36진수로 돌려준다.
 *
 * 내용을 통째로 들고 있지 않고 같은 내용인지만 견줄 때 쓴다(덱 지문, 프레젠테이션 판 지문).
 * 세트 수만큼 본문을 한 벌 더 들고 있으면 메모리를 그만큼 쓴다. 암호용 해시가 아니라 서로 다른
 * 내용이 우연히 같은 값이 될 수 있지만, 53비트라 한 세트의 판 몇십 개 사이에서는 무시할 만하다.
 */
export function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
