import type { Transaction } from "@google-cloud/firestore";
import { createId } from "#shared";
import type { Db } from "../client";
import {
  decksCol,
  moderationEventsCol,
  type DeckDoc,
  type ModerationEventDoc,
} from "../collections";

/**
 * 게시 중단된 원본을 찾으려고 거슬러 올라가는 원본 수. 곡을 공개하거나 지우는 트랜잭션이 읽는 문서
 * 수를 묶는다. 가져간 곡을 다시 가져간 사슬이 그보다 길면 그 너머는 보지 않는다.
 */
export const MAX_FORK_ANCESTORS = 10;

/** 곡 id로 곡 문서를 읽는다. 없으면 `undefined` */
export type DeckReader = (deckId: string) => Promise<DeckDoc | undefined>;

/**
 * 이 곡이 가져온 원본을 거슬러 올라가며 처음 만나는 게시 중단된 곡. 없으면 `null`이다.
 *
 * 원본을 게시 중단해도 가져간 사본은 지우지 않는다. 그래서 사본은 물론 사본을 다시 가져간 곡도
 * 공개하지 못하게 해야(`setDeckVisibility`) 게시 중단한 가사가 사본으로 다시 올라오지 않는다.
 * 원본이 지워지면 `forkedFrom`이 비어 사슬이 끊기므로, 지울 때 가져간 곡이 게시 중단을 이어받는다
 * (`deleteDeckScoped`). 원본은 `MAX_FORK_ANCESTORS`개까지만 거슬러 올라간다.
 *
 * 문서는 `read`로 읽는다. 공개·삭제 트랜잭션(`findTakenDownSource`)과 운영 도구가 같은 길로 찾아,
 * 운영 도구가 막혔다고 보여 주는 곡과 실제로 공개하지 못하는 곡이 어긋나지 않는다.
 */
export async function findTakenDownAncestor(
  read: DeckReader,
  deck: Pick<DeckDoc, "forkedFrom">,
): Promise<DeckDoc | null> {
  let sourceId = deck.forkedFrom;
  for (let hop = 0; sourceId && hop < MAX_FORK_ANCESTORS; hop++) {
    const source = await read(sourceId);
    if (!source) return null;
    if (source.takedownAt) return source;
    sourceId = source.forkedFrom;
  }
  return null;
}

/** 트랜잭션 안에서 `findTakenDownAncestor`로 찾는다. 트랜잭션의 읽기 단계에서 부른다 */
export async function findTakenDownSource(
  tx: Transaction,
  db: Db,
  deck: Pick<DeckDoc, "forkedFrom">,
): Promise<DeckDoc | null> {
  return findTakenDownAncestor(
    async (deckId) => (await tx.get(decksCol(db).doc(deckId))).data(),
    deck,
  );
}

/** 운영 기록(`ModerationEventDoc`) 한 건을 그 일과 같은 트랜잭션에 쓴다 */
export function recordModerationEvent(
  tx: Transaction,
  db: Db,
  event: Omit<ModerationEventDoc, "id">,
): void {
  const id = createId();
  tx.set(moderationEventsCol(db).doc(id), { id, ...event });
}
