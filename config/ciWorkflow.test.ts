import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const workflowDir = path.resolve(__dirname, "../.github/workflows");
const readWorkflow = (file: string): string =>
  fs.readFileSync(path.join(workflowDir, file), "utf-8");

function jobOf(workflow: string, name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}[\w-]+:\n/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

describe("CI/CD 워크플로", () => {
  const ciCd = readWorkflow("ci-cd.yml");

  it("Cloudflare Worker만 바꾼 PR도 필수 검사를 건너뛰지 않는다", () => {
    const filters = [
      ...jobOf(ciCd, "changes").matchAll(/^\s+- '([^']+)'$/gm),
    ].map((match) => match[1]);
    expect(filters).toContain("src/**");
    expect(filters).toContain("infra/**");
  });
});
