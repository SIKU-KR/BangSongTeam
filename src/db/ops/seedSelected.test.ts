import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OFFICIAL_LIBRARY_NAME, OFFICIAL_LIBRARY_USER_ID } from "#shared";
import type { Db } from "../client";
import { decksCol } from "../collections";
import {
  createTestDb,
  deckDoc,
  seedDocs,
  spawnScript,
  userDoc,
} from "../test/fixtures";

const SEEDED = "c00000000000000000001";
const LYRICS = "Love, 내 맘 사로잡는 하나님의 사랑";
const STALE_NOTICE = "공식 곡 1개가 아직 고치기 전 제목입니다";

describe("scripts/seedSelected.mjs", () => {
  let db: Db;
  let workDir: string;

  const writeSongs = (titles: [title: string, artist: string][]): string => {
    const file = path.join(workDir, "songs.json");
    fs.writeFileSync(
      file,
      JSON.stringify(
        titles.map(([title, artist]) => ({ title, artist, lyrics: LYRICS })),
      ),
    );
    return file;
  };

  const seedOfficial = (title: string) =>
    seedDocs(db, {
      users: [
        userDoc({ id: OFFICIAL_LIBRARY_USER_ID, name: OFFICIAL_LIBRARY_NAME }),
      ],
      decks: [
        deckDoc({
          id: SEEDED,
          userId: OFFICIAL_LIBRARY_USER_ID,
          title,
          artist: "천관웅",
          visibility: "public",
          publishedAt: new Date(1),
        }),
      ],
    });

  const officialSongs = async () =>
    (
      await decksCol(db).where("userId", "==", OFFICIAL_LIBRARY_USER_ID).get()
    ).docs
      .map((doc) => `${doc.data().title} / ${doc.data().artist}`)
      .sort();

  beforeEach(() => {
    db = createTestDb();
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-selected-"));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("고친 원본을 시드해도 옛 제목으로 들어간 공식 곡을 다시 넣지 않고 제목을 고치라고 알린다", async () => {
    await seedOfficial("Love &amp; Grace");
    const songs = writeSongs([
      ["Love & Grace", "천관웅"],
      ["주 은혜임을", "마커스워십"],
    ]);

    const result = await spawnScript(db, "seedSelected.mjs", [
      `--json=${songs}`,
      "--dry-run",
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("새로 넣을 곡: 1개");
    expect(result.stdout).toContain(STALE_NOTICE);
    expect(await officialSongs()).toEqual(["Love &amp; Grace / 천관웅"]);
  }, 60_000);

  it("옛 제목의 원본은 고친 제목과 견주고, 새 곡은 고친 제목으로 넣는다", async () => {
    await seedOfficial("Love & Grace");
    const songs = writeSongs([
      ["Love &amp; Grace", "천관웅"],
      ["John 1_12(영접하는 자마다)", "달빛마을"],
    ]);

    const result = await spawnScript(db, "seedSelected.mjs", [
      `--json=${songs}`,
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("새로 넣을 곡: 1개");
    expect(result.stdout).not.toContain(STALE_NOTICE);
    expect(await officialSongs()).toEqual([
      "John 1:12(영접하는 자마다) / 달빛마을",
      "Love & Grace / 천관웅",
    ]);
  }, 60_000);
});
