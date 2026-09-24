import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MODERATION_SQL } from "./moderationSql";
import { BACKGROUND_SQL } from "./backgroundSql";

describe("docs/ops/moderation-runbook.md", () => {
  const runbook = fs.readFileSync(
    path.resolve(__dirname, "../../../docs/ops/moderation-runbook.md"),
    "utf-8",
  );

  for (const [name, sql] of Object.entries(MODERATION_SQL)) {
    it(`contains ${name} verbatim`, () => {
      expect(runbook).toContain(sql);
    });
  }
});

describe("docs/ops/background-runbook.md", () => {
  const runbook = fs.readFileSync(
    path.resolve(__dirname, "../../../docs/ops/background-runbook.md"),
    "utf-8",
  );

  for (const [name, sql] of Object.entries(BACKGROUND_SQL)) {
    it(`contains ${name} verbatim`, () => {
      expect(runbook).toContain(sql);
    });
  }
});
