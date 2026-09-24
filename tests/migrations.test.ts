import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const migrationsDir = path.resolve(__dirname, "../migrations");
const initialSql = fs.readFileSync(
  path.join(migrationsDir, "0001_initial.sql"),
  "utf-8",
);

describe("0001_initial 마이그레이션", () => {
  it("배경 행을 넣지 않는다 (R2 파일 없는 배경 금지)", () => {
    expect(initialSql).not.toMatch(
      /INSERT\s+(OR\s+\w+\s+)?INTO\s+`?backgrounds`?/i,
    );
  });

  it("backgrounds가 사전 주입·사용자 배경을 구분하는 컬럼과 인덱스를 갖는다", () => {
    const table = initialSql.match(
      /CREATE TABLE `backgrounds` \(([\s\S]*?)\);/,
    );
    expect(table).not.toBeNull();
    const body = table?.[1] ?? "";
    expect(body).toContain("`source` text DEFAULT 'service' NOT NULL");
    expect(body).toContain("`owner_user_id` text");
    expect(body).toContain("`kind` text DEFAULT 'video' NOT NULL");
    expect(body).toContain("`size_bytes` integer DEFAULT 0 NOT NULL");
    expect(body).toContain(
      "FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade",
    );
    expect(initialSql).toContain("CREATE INDEX `idx_backgrounds_source`");
    expect(initialSql).toContain("CREATE INDEX `idx_backgrounds_owner`");
  });

  it("저널은 0001_initial, 0002_drop_user_backgrounds 순서다 (다음 생성은 0003부터)", () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf-8"),
    ) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries).toEqual([
      expect.objectContaining({ idx: 1, tag: "0001_initial" }),
      expect.objectContaining({ idx: 2, tag: "0002_drop_user_backgrounds" }),
    ]);
    expect(
      fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")),
    ).toEqual(["0001_initial.sql", "0002_drop_user_backgrounds.sql"]);
  });
});

describe("0002_drop_user_backgrounds 마이그레이션", () => {
  const sql = fs.readFileSync(
    path.join(migrationsDir, "0002_drop_user_backgrounds.sql"),
    "utf-8",
  );
  const statements = sql
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n");

  it("사용자 업로드 행만 지운다", () => {
    expect(statements.trim()).toBe(
      "DELETE FROM `backgrounds` WHERE `source` = 'user';",
    );
  });

  it("부모 테이블을 내리거나 다시 만들지 않는다 (자식 행 연쇄 삭제 방지)", () => {
    expect(statements).not.toMatch(/DROP\s+TABLE|CREATE\s+TABLE|RENAME/i);
    expect(statements).not.toMatch(
      /INSERT\s+(OR\s+\w+\s+)?INTO\s+`?backgrounds`?/i,
    );
  });
});
