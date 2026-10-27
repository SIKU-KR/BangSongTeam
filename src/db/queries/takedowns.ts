import type { Transaction } from "@google-cloud/firestore";
import { createId } from "#shared";
import type { Db } from "../client";
import {
  decksCol,
  moderationEventsCol,
  type DeckDoc,
  type ModerationEventDoc,
} from "../collections";

const MAX_FORK_ANCESTORS = 10;

/**
 * 이 곡이 가져온 원본을 거슬러 올라가며 처음 만나는 게시 중단된 곡. 없으면 `null`이다.
 *
 * 원본을 게시 중단해도 가져간 사본은 지우지 않는다. 그래서 사본은 물론 사본을 다시 가져간 곡도
 * 공개하지 못하게 해야(`setDeckVisibility`) 게시 중단한 가사가 사본으로 다시 올라오지 않는다.
 * 원본이 지워지면 `forkedFrom`이 비어 사슬이 끊기므로, 지울 때 가져간 곡이 게시 중단을 이어받는다
 * (`deleteDeckScoped`). 트랜잭션의 읽기 단계에서 부른다.
 *
 * 곡을 공개하거나 지우는 트랜잭션이 읽는 문서 수를 묶으려고 원본은 `MAX_FORK_ANCESTORS`개까지만
 * 거슬러 올라간다. 가져간 곡을 다시 가져간 사슬이 그보다 길면 그 너머는 보지 않는다.
 */
export async function findTakenDownSource(
  tx: Transaction,
  db: Db,
  deck: Pick<DeckDoc, "forkedFrom">,
): Promise<DeckDoc | null> {
  let sourceId = deck.forkedFrom;
  for (let hop = 0; sourceId && hop < MAX_FORK_ANCESTORS; hop++) {
    const source = (await tx.get(decksCol(db).doc(sourceId))).data();
    if (!source) return null;
    if (source.takedownAt) return source;
    sourceId = source.forkedFrom;
  }
  return null;
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
