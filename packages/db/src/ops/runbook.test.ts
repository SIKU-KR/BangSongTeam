import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MODERATION_SQL } from "./moderationSql";

/**
 * 런북과 SQL 정본이 갈라지지 않게 한다 (`seed/backgrounds.test.ts`와 같은 방식).
 * 운영 중에 런북을 복사해 실행했는데 컬럼이 바뀌어 있으면 사고가 난다.
 */
describe("docs/ops/moderation-runbook.md", () => {
  const runbook = fs.readFileSync(
    path.resolve(__dirname, "../../../../docs/ops/moderation-runbook.md"),
    "utf-8",
  );

  for (const [name, sql] of Object.entries(MODERATION_SQL)) {
    it(`contains ${name} verbatim`, () => {
      expect(runbook).toContain(sql);
    });
  }
});
