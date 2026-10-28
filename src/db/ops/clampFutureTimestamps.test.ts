import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import { decksCol, foldersCol, presentationsCol } from "../collections";
import { withDeckIndex } from "../deckIndex";
import {
  createTestDb,
  deckDoc,
  folderDoc,
  presentationDoc,
  seedDocs,
  userDoc,
} from "../test/fixtures";
import { clampFutureTimestamps } from "./clampFutureTimestamps";

const OWNER = "00000000000000000000a";
const NOW = new Date("2026-10-27T00:00:00.000Z");
const FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");
const PAST = new Date("2026-10-01T00:00:00.000Z");
const WITHIN_SKEW = new Date(NOW.getTime() + 4 * 60_000);

describe("clampFutureTimestamps", () => {
  let db: Db;

  const deck = async (id: string) => (await decksCol(db).doc(id).get()).data();
  const folder = async (id: string) =>
    (await foldersCol(db).doc(id).get()).data();
  const presentation = async (id: string) =>
    (await presentationsCol(db).doc(id).get()).data();

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [userDoc({ id: OWNER })],
      decks: [
        deckDoc({
          id: "pinned",
          userId: OWNER,
          title: "미래에 박힌 곡",
          visibility: "public",
          slides: JSON.stringify([{ id: "s", order: 0, lines: ["가사"] }]),
          createdAt: PAST,
          updatedAt: FAR_FUTURE,
        }),
        deckDoc({
          id: "born-later",
          userId: OWNER,
          createdAt: FAR_FUTURE,
          updatedAt: PAST,
        }),
        deckDoc({
          id: "normal",
          userId: OWNER,
          createdAt: PAST,
          updatedAt: WITHIN_SKEW,
        }),
      ],
      folders: [
        folderDoc({
          id: "f-future",
          userId: OWNER,
          createdAt: FAR_FUTURE,
          updatedAt: FAR_FUTURE,
        }),
        folderDoc({ id: "f-normal", userId: OWNER, updatedAt: PAST }),
      ],
      presentations: [
        presentationDoc({
          id: "p-future",
          userId: OWNER,
          createdAt: PAST,
          updatedAt: FAR_FUTURE,
        }),
        presentationDoc({ id: "p-normal", userId: OWNER, updatedAt: PAST }),
      ],
    });
  });

  it("미리보기는 지금 + 5분보다 늦은 시각을 가진 문서만 찾고 아무것도 바꾸지 않는다", async () => {
    const found = await clampFutureTimestamps(db, { now: NOW });

    expect({
      decks: [...found.decks].sort(),
      folders: found.folders,
      presentations: found.presentations,
    }).toEqual({
      decks: ["born-later", "pinned"],
      folders: ["f-future"],
      presentations: ["p-future"],
    });
    expect((await deck("pinned"))?.updatedAt).toEqual(FAR_FUTURE);
    expect((await folder("f-future"))?.createdAt).toEqual(FAR_FUTURE);
    expect((await presentation("p-future"))?.updatedAt).toEqual(FAR_FUTURE);
  });

  it("apply면 미래 시각을 지금으로 줄이고 곡의 공개 범위·검색 색인은 그대로 맞춘다", async () => {
    const before = await deck("pinned");

    const clamped = await clampFutureTimestamps(db, { apply: true, now: NOW });

    expect([...clamped.decks].sort()).toEqual(["born-later", "pinned"]);
    const pinned = await deck("pinned");
    expect(pinned).toEqual({ ...before, updatedAt: NOW });
    expect(pinned?.listed).toBe(true);
    expect(pinned && withDeckIndex(pinned).searchGrams).toEqual(
      pinned?.searchGrams,
    );
    expect(await folder("f-future")).toMatchObject({
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await presentation("p-future")).toMatchObject({
      createdAt: PAST,
      updatedAt: NOW,
    });
  });

  it("만든 시각만 미래면 고친 시각보다 늦지 않게 줄인다", async () => {
    await clampFutureTimestamps(db, { apply: true, now: NOW });

    expect(await deck("born-later")).toMatchObject({
      createdAt: PAST,
      updatedAt: PAST,
    });
  });

  it("5분 안의 앞섬과 보통 문서는 건드리지 않고, 다시 실행하면 고칠 것이 없다", async () => {
    const normal = await deck("normal");

    await clampFutureTimestamps(db, { apply: true, now: NOW });

    expect(await deck("normal")).toEqual(normal);
    expect((await folder("f-normal"))?.updatedAt).toEqual(PAST);
    expect((await presentation("p-normal"))?.updatedAt).toEqual(PAST);
    expect(await clampFutureTimestamps(db, { apply: true, now: NOW })).toEqual({
      decks: [],
      folders: [],
      presentations: [],
    });
  });

  it("한 번에 읽는 쪽보다 많은 문서도 모두 찾는다", async () => {
    await seedDocs(db, {
      folders: Array.from({ length: 205 }, (_, n) =>
        folderDoc({
          id: `bulk-${String(n).padStart(3, "0")}`,
          userId: OWNER,
          updatedAt: FAR_FUTURE,
        }),
      ),
    });

    const found = await clampFutureTimestamps(db, { now: NOW });

    expect(found.folders).toHaveLength(206);
  });
});
