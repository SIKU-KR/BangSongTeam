import {
  FieldPath,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "@google-cloud/firestore";
import { fitDeckText, toDisplayName } from "#shared";
import type { Db } from "../client";
import { COLLECTIONS, decksCol, usersCol } from "../collections";
import { withDeckIndex } from "../deckIndex";

const PAGE_SIZE = 300;

async function scan(
  db: Db,
  collection: string,
  fields: readonly string[],
  visit: (doc: QueryDocumentSnapshot<DocumentData>) => void,
): Promise<void> {
  let last: QueryDocumentSnapshot<DocumentData> | undefined;
  for (;;) {
    const query = db
      .collection(collection)
      .orderBy(FieldPath.documentId())
      .select(...fields)
      .limit(PAGE_SIZE);
    const page = await (last ? query.startAfter(last) : query).get();
    for (const doc of page.docs) visit(doc);
    last = page.docs.at(-1);
    if (page.size < PAGE_SIZE) return;
  }
}

function deckTextDiffers(deck: DocumentData): boolean {
  const fitted = fitDeckText({
    title: deck.title,
    artist: deck.artist,
    forkedFromAuthorName: deck.forkedFromAuthorName,
  });
  return (
    fitted.title !== deck.title ||
    fitted.artist !== deck.artist ||
    fitted.forkedFromAuthorName !== deck.forkedFromAuthorName
  );
}

async function fitStoredDeck(db: Db, id: string): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = decksCol(db).doc(id);
    const deck = (await tx.get(ref)).data();
    if (!deck || !deckTextDiffers(deck)) return false;
    const next = withDeckIndex({ ...deck, ...fitDeckText(deck) });
    tx.update(ref, {
      title: next.title,
      artist: next.artist,
      forkedFromAuthorName: next.forkedFromAuthorName,
      listed: next.listed,
      searchGrams: next.searchGrams,
    });
    return true;
  });
}

async function fitStoredName(db: Db, id: string): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = usersCol(db).doc(id);
    const user = (await tx.get(ref)).data();
    if (!user) return false;
    const name = toDisplayName(user.name);
    if (name === user.name) return false;
    tx.update(ref, { name });
    return true;
  });
}

/** `textLimits` 결과. 미리보기면 찾은 문서, `apply`면 실제로 고친 문서 id다 */
export interface TextLimitsResult {
  decks: string[];
  users: string[];
}

/**
 * 저장된 글이 앱이 보여 주는 값과 다른 곡과 사용자를 찾고, `apply`면 그 값으로 고친다.
 * `scripts/dataAudit.mjs text-limits`가 쓴다.
 *
 * 곡은 제목·아티스트·원작자 이름이 `fitDeckText`를 거친 값과 다를 때(100자를 넘는 메들리 제목,
 * 비었거나 문자열이 아닌 제목, 문자열이 아니거나 100자를 넘는 원작자 이름), 사용자는 이름이
 * `toDisplayName`을 거친 값과 다를 때(문자열이 아니거나, 비었거나, 앞뒤에 공백이 있거나, 50자를 넘는
 * 이름) 고친다. 응답은 이미 읽을 때 이 값으로 다듬으므로 바로잡지 않아도 앱은 바르게 돌고, 이 작업은
 * 운영 데이터에 한도를 넘는 글이 얼마나 남았는지 세고 저장본도 맞춰 둔다.
 *
 * 곡·사용자 컬렉션 전체를 문서 id순으로 나눠 읽되 글 필드만 받아, 가사·슬라이드처럼 큰 필드는 읽지
 * 않는다. 문서마다 트랜잭션 하나에서 다시 읽고 고치며, 곡은 고친 문서를 `withDeckIndex`에 통과시키고
 * 바뀌는 필드만 쓴다. 수정 시각은 그대로 둔다. 사용자가 고친 것이 아니고, 공유 라이브러리의 동률
 * 정렬이 그 값을 쓴다. 다시 실행해도 고칠 것이 남은 문서만 쓴다.
 */
export async function textLimits(
  db: Db,
  { apply = false }: { apply?: boolean } = {},
): Promise<TextLimitsResult> {
  const deckIds: string[] = [];
  await scan(
    db,
    COLLECTIONS.decks,
    ["title", "artist", "forkedFromAuthorName"],
    (doc) => {
      if (deckTextDiffers(doc.data())) deckIds.push(doc.id);
    },
  );
  const userIds: string[] = [];
  await scan(db, COLLECTIONS.users, ["name"], (doc) => {
    const name: unknown = doc.get("name");
    if (toDisplayName(name) !== name) userIds.push(doc.id);
  });
  if (!apply) return { decks: deckIds, users: userIds };

  const decks: string[] = [];
  for (const id of deckIds) {
    if (await fitStoredDeck(db, id)) decks.push(id);
  }
  const users: string[] = [];
  for (const id of userIds) {
    if (await fitStoredName(db, id)) users.push(id);
  }
  return { decks, users };
}

export interface FolderCount {
  userId: string;
  folders: number;
}

export interface FolderCountsResult {
  /** 모든 폴더 수 */
  total: number;
  /** 폴더가 하나라도 있는 사용자 수 */
  users: number;
  /** 폴더가 많은 사용자부터 `top`명 */
  top: FolderCount[];
}

/**
 * 사용자마다 폴더 수를 센다(읽기만 한다). `scripts/dataAudit.mjs folder-counts`가 쓴다.
 *
 * 사용자당 폴더 수 상한을 정하기 전에 운영 데이터에서 가장 많이 쓰는 사람이 몇 개를 쓰는지 본다.
 * 폴더 문서는 `userId`만 읽는다.
 */
export async function folderCounts(
  db: Db,
  { top = 20 }: { top?: number } = {},
): Promise<FolderCountsResult> {
  const counts = new Map<string, number>();
  let total = 0;
  await scan(db, COLLECTIONS.folders, ["userId"], (doc) => {
    total += 1;
    const userId = String(doc.get("userId"));
    counts.set(userId, (counts.get(userId) ?? 0) + 1);
  });
  const ranked = [...counts]
    .map(([userId, folders]) => ({ userId, folders }))
    .sort(
      (a, b) =>
        b.folders - a.folders ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );
  return { total, users: counts.size, top: ranked.slice(0, top) };
}
