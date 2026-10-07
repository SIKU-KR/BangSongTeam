import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const migrationsDir = path.resolve(__dirname, "migrations");
const initialSql = fs.readFileSync(
  path.join(migrationsDir, "0001_initial.sql"),
  "utf-8",
);

describe("0001_initial 마이그레이션", () => {
  it("저널은 0001_initial에서 시작한다", () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf-8"),
    ) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries[0]).toEqual(
      expect.objectContaining({ idx: 1, tag: "0001_initial" }),
    );
    expect(
      fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")),
    ).toEqual(journal.entries.map((entry) => `${entry.tag}.sql`));
  });

  it("배경 행을 넣지 않는다 (R2 파일 없는 배경 금지)", () => {
    expect(initialSql).not.toMatch(
      /INSERT\s+(OR\s+\w+\s+)?INTO\s+`?backgrounds`?/i,
    );
  });

  it("decks_fts는 일반 테이블이 아니라 FTS5 가상 테이블이다", () => {
    expect(initialSql).not.toMatch(/CREATE TABLE `decks_fts`/);
    expect(initialSql).toMatch(/CREATE VIRTUAL TABLE decks_fts USING fts5/);
  });

  it("FTS 색인 조건이 public_decks 뷰·부분 인덱스와 같다", () => {
    const publicCondition =
      "presentation_id IS NULL AND {row}.visibility = 'public' AND {row}.taken_down_at IS NULL";
    for (const row of ["new", "old"]) {
      expect(initialSql).toContain(
        `${row}.${publicCondition.replaceAll("{row}", row)}`,
      );
    }
    expect(initialSql).toMatch(
      /CREATE VIEW `public_decks` AS .* where \("decks"\."presentation_id" is null and "decks"\."visibility" = 'public' and "decks"\."taken_down_at" is null\)/,
    );
    expect(initialSql).toContain(
      `CREATE INDEX \`idx_decks_public\` ON \`decks\` (\`fork_count\`,\`updated_at\`) WHERE "decks"."presentation_id" IS NULL AND "decks"."visibility" = 'public' AND "decks"."taken_down_at" IS NULL;`,
    );
  });

  it("가져간 횟수 트리거가 있다", () => {
    for (const name of [
      "trg_decks_fork_count_insert",
      "trg_decks_fork_count_delete",
      "trg_decks_fork_count_update",
    ]) {
      expect(initialSql).toContain(`CREATE TRIGGER ${name}`);
    }
  });

  it("지워지는 부모를 가리키는 선택적 참조는 SET NULL이다", () => {
    for (const fk of [
      "FOREIGN KEY (`background_id`) REFERENCES `backgrounds`(`id`) ON UPDATE no action ON DELETE set null",
      "FOREIGN KEY (`forked_from`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE set null",
      "FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null",
      "FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null",
      "FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE set null",
    ]) {
      expect(initialSql).toContain(fk);
    }
  });
});
