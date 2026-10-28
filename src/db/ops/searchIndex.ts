import { FieldPath } from "@google-cloud/firestore";
import type { Db } from "../client";
import { decksCol, type DeckDoc } from "../collections";
import { withDeckIndex } from "../deckIndex";

const PAGE_SIZE = 100;

type DeckIndex = Pick<DeckDoc, "listed" | "searchGrams">;

interface ReindexedPage {
  size: number;
  lastId: string | undefined;
  updated: number;
}

function sameIndex(stored: Partial<DeckIndex>, current: DeckIndex): boolean {
  const { searchGrams } = stored;
  return (
    stored.listed === current.listed &&
    Array.isArray(searchGrams) &&
    searchGrams.length === current.searchGrams.length &&
    current.searchGrams.every((gram, index) => searchGrams[index] === gram)
  );
}

function reindexPage(
  db: Db,
  afterId: string | undefined,
): Promise<ReindexedPage> {
  return db.runTransaction(async (tx) => {
    const ordered = decksCol(db)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    const snapshot = await tx.get(
      afterId === undefined ? ordered : ordered.startAfter(afterId),
    );
    let updated = 0;
    for (const doc of snapshot.docs) {
      const deck = doc.data();
      const { listed, searchGrams } = withDeckIndex(deck);
      if (sameIndex(deck, { listed, searchGrams })) continue;
      tx.update(doc.ref, { listed, searchGrams });
      updated += 1;
    }
    return { size: snapshot.size, lastId: snapshot.docs.at(-1)?.id, updated };
  });
}

/**
 * 저장된 곡의 공개 범위·검색 색인을 지금 규칙(`withDeckIndex`)으로 다시 만든다.
 * `scripts/reindexDecks.mjs`가 쓴다.
 *
 * 색인 규칙이 바뀌면 그 뒤에 저장한 곡만 새 색인을 가진다. 배포 중에는 이전 릴리스도 옛 규칙으로
 * 곡을 저장하므로 배포가 끝난 뒤 돌린다. 색인이 달라진 곡의 두 필드만 고치고 `updatedAt`은 그대로
 * 둔다. 곡을 고친 시각이라 사용자에게 보이고 인기순 정렬의 동률도 이 값으로 가른다. 페이지마다 한
 * 트랜잭션에서 읽고 써서 그 사이 앱이 저장한 곡을 옛 내용의 색인으로 덮지 않는다. 다시 돌려도
 * 바뀐 곡만 쓴다.
 */
export async function reindexDecks(
  db: Db,
): Promise<{ scanned: number; updated: number }> {
  let scanned = 0;
  let updated = 0;
  let afterId: string | undefined;
  let page: ReindexedPage;
  do {
    page = await reindexPage(db, afterId);
    scanned += page.size;
    updated += page.updated;
    afterId = page.lastId;
  } while (page.size === PAGE_SIZE);
  return { scanned, updated };
}
