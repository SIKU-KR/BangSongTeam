import { fitPresentationToLimits, type Presentation } from "#shared";
import { cyrb53 } from "./contentHash";

const MAX_LINEAGE = 20;

const HEADER_EXCLUDED = new Set([
  "createdAt",
  "updatedAt",
  "baseUpdatedAt",
  "userId",
  "access",
]);
const ITEM_EXCLUDED = new Set(["presentationId", "deckId", "order"]);
/**
 * 곡 지문에서 빼는 필드. `visibility`·`forkCount`·`origin`·`publishedAt`·`takedownAt`은 공유
 * 라이브러리를 걷어내기 전 판의 필드라 지금 `Deck`에는 없지만, 캐시된 옛 판이 쓴 저장본과 계보에는
 * 남아 있다. 그대로 두어야 옛 저장본과 지금 문서의 지문이 같게 나와 같은 판을 다른 판으로 보지
 * 않는다.
 */
const DECK_EXCLUDED = new Set([
  "userId",
  "scope",
  "presentationId",
  "visibility",
  "forkCount",
  "forkedFrom",
  "origin",
  "forkedFromAuthorName",
  "publishedAt",
  "takedownAt",
  "createdAt",
  "updatedAt",
]);
const SLIDE_EXCLUDED = new Set(["order"]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function without(
  record: UnknownRecord,
  excluded: ReadonlySet<string>,
): UnknownRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !excluded.has(key)),
  );
}

function orderOf(value: unknown): number {
  return isRecord(value) && typeof value.order === "number" ? value.order : 0;
}

function inOrder(list: readonly unknown[]): unknown[] {
  return [...list].sort((a, b) => orderOf(a) - orderOf(b));
}

function toIsoOrNull(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}

function canonicalDeck(deck: unknown): unknown {
  if (!isRecord(deck)) return deck ?? null;
  return {
    ...without(deck, DECK_EXCLUDED),
    backgroundId: deck.backgroundId ?? null,
    slides: Array.isArray(deck.slides)
      ? inOrder(deck.slides).map((slide) =>
          isRecord(slide) ? without(slide, SLIDE_EXCLUDED) : slide,
        )
      : deck.slides,
  };
}

function canonicalItem(item: unknown): unknown {
  if (!isRecord(item)) return item;
  return { ...without(item, ITEM_EXCLUDED), deck: canonicalDeck(item.deck) };
}

function canonicalDocument(doc: Presentation): unknown {
  const fitted = fitPresentationToLimits(doc);
  if (!isRecord(fitted)) return fitted;
  return {
    ...without(fitted, HEADER_EXCLUDED),
    folderId: fitted.folderId ?? null,
    trashedAt: toIsoOrNull(fitted.trashedAt),
    items: Array.isArray(fitted.items)
      ? inOrder(fitted.items).map(canonicalItem)
      : fitted.items,
  };
}

function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, withSortedKeys(value[key])]),
  );
}

/**
 * 프레젠테이션 내용의 지문. 두 판의 지문이 같으면 사용자가 바꿀 수 있는 내용이 모두 같다.
 *
 * 서버에 올리는 것과 같은 글 한도 안의 문서(`fitPresentationToLimits`)를 키 순서와 상관없이 해시한다.
 * 그래서 서버가 줄인 긴 제목은 다른 내용으로 보지 않는다. 곡은 곡 순서대로, 슬라이드는 놓인
 * 차례대로 보고 순서 번호는 보지 않는다. 서버가 순서를 0부터 다시 매긴다. 없는 폴더·휴지통·배경은
 * `null`로, 시각은 ISO로 맞춘다.
 *
 * 빼는 필드만 정해 두고 나머지는 모두 본다. 수정 시각·기준 판·소유자·공유 정보, 항목의 소속,
 * 서버가 정하거나 고쳐 쓰는 곡 필드(소유·공개 상태·가져간 횟수·출처·원작 표시·게시 시각·시각)다.
 * 새로 생긴 필드도 보아야, 그 필드만 바꾼 다른 기기의 수정을 같은 판으로 보고 덮지 않는다.
 */
export function contentFingerprint(doc: Presentation): string {
  return cyrb53(JSON.stringify(withSortedKeys(canonicalDocument(doc))));
}

const lineages = new Map<string, string[]>();

/**
 * 이 탭이 서버에 올렸거나 저장소에 쓴 판을 그 세트의 계보에 적는다. 같은 판을 잇달아 적으면 한 번만
 * 남기고, 최근 `MAX_LINEAGE`(20)개만 둔다. 메모리에만 둔다.
 *
 * 계보는 서버가 마지막으로 확정한 판부터 이 탭이 그 위에 쌓은 판들이다. 412가 돌려준 저장된 판이
 * 계보에 있으면 그 판은 이 탭이 만든 판이라(응답을 잃은 저장, 다른 탭이 올린 이 탭의 판), 지금 판을
 * 다시 보내도 다른 곳의 수정을 덮지 않는다(`isKnownAncestor`).
 */
export function noteOwnVersion(doc: Presentation): void {
  const fingerprint = contentFingerprint(doc);
  const lineage = lineages.get(doc.id) ?? [];
  if (lineage.at(-1) === fingerprint) return;
  lineages.set(doc.id, [...lineage, fingerprint].slice(-MAX_LINEAGE));
}

/**
 * 밖에서 바꾼 판(저장본 싣기, 다른 탭의 저장본 다시 읽기, 서버본 받기)으로 계보를 새로 시작한다.
 * 이 탭이 쌓지 않은 조상을 아는 척하지 않아, 판단이 틀려도 사본이 하나 더 생길 뿐 덮지 않는다.
 */
export function resetLineage(doc: Presentation): void {
  lineages.set(doc.id, [contentFingerprint(doc)]);
}

/**
 * 서버가 확정한 판부터 남기고 그 앞의 판은 버린다. 모르는 판이면 그 판에서 새로 시작한다.
 *
 * 확정한 판보다 앞선 판은 조상이 아니다. 다른 기기가 되돌리기로 그 판의 내용을 다시 올렸을 때 그것을
 * 이 탭의 판으로 보면 그 되돌리기를 덮는다(ABA).
 */
export function confirmVersion(doc: Presentation): void {
  const fingerprint = contentFingerprint(doc);
  const lineage = lineages.get(doc.id) ?? [];
  const at = lineage.lastIndexOf(fingerprint);
  lineages.set(doc.id, at >= 0 ? lineage.slice(at) : [fingerprint]);
}

/** 그 지문의 판이 마지막으로 확정한 판 뒤로 이 탭이 만든 판인지 */
export function isKnownAncestor(id: string, fingerprint: string): boolean {
  return lineages.get(id)?.includes(fingerprint) ?? false;
}

/** 이 탭에서 사라진 세트의 계보를 잊는다 */
export function forgetLineage(id: string): void {
  lineages.delete(id);
}

export function __resetLineageForTests(): void {
  lineages.clear();
}
