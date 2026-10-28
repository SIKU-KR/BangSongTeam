import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import { decksCol, type DeckDoc } from "../collections";
import { createTestDb, deckDoc, seedDocs } from "../test/fixtures";
import {
  findTakenDownAncestor,
  findTakenDownSource,
  MAX_FORK_ANCESTORS,
} from "./takedowns";

const OWNER = "00000000000000000000a";
const chainId = (depth: number): string =>
  `c${String(depth).padStart(20, "0")}`;

describe("게시 중단된 원본 찾기", () => {
  let db: Db;

  const read = async (id: string): Promise<DeckDoc | undefined> =>
    (await decksCol(db).doc(id).get()).data();
  const deckAt = async (depth: number): Promise<DeckDoc> => {
    const deck = await read(chainId(depth));
    if (!deck) throw new Error(chainId(depth));
    return deck;
  };
  const inTransaction = (deck: DeckDoc): Promise<DeckDoc | null> =>
    db.runTransaction((tx) => findTakenDownSource(tx, db, deck));

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      decks: Array.from({ length: MAX_FORK_ANCESTORS + 2 }, (_, depth) =>
        deckDoc({
          id: chainId(depth),
          userId: OWNER,
          forkedFrom: depth === 0 ? null : chainId(depth - 1),
          takedownAt: depth === 0 ? new Date(1) : null,
        }),
      ),
    });
  });

  it(`원본을 ${MAX_FORK_ANCESTORS}단계 위까지 거슬러 올라가 게시 중단된 곡을 찾는다`, async () => {
    const atLimit = await deckAt(MAX_FORK_ANCESTORS);

    expect((await inTransaction(atLimit))?.id).toBe(chainId(0));
    expect((await findTakenDownAncestor(read, atLimit))?.id).toBe(chainId(0));
  });

  it(`${MAX_FORK_ANCESTORS}단계 너머의 원본은 보지 않는다`, async () => {
    const beyond = await deckAt(MAX_FORK_ANCESTORS + 1);

    expect(await inTransaction(beyond)).toBeNull();
    expect(await findTakenDownAncestor(read, beyond)).toBeNull();
  });

  it("가장 가까운 게시 중단된 원본을 돌려주고, 원본이 지워져 사슬이 끊기면 null이다", async () => {
    await decksCol(db)
      .doc(chainId(3))
      .update({ takedownAt: new Date(2) });
    await decksCol(db).doc(chainId(6)).delete();

    expect((await findTakenDownAncestor(read, await deckAt(5)))?.id).toBe(
      chainId(3),
    );
    expect(await findTakenDownAncestor(read, await deckAt(7))).toBeNull();
  });
});
