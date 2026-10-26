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

describe("GitHub Actions 워크플로", () => {
  it("모든 액션을 전체 커밋 SHA로 고정하고 버전을 주석으로 남긴다", () => {
    const references = fs
      .readdirSync(workflowDir)
      .filter((file) => /\.ya?ml$/.test(file))
      .flatMap((file) =>
        readWorkflow(file)
          .split("\n")
          .map((line) => line.trim().replace(/^- /, ""))
          .filter((line) => line.startsWith("uses:"))
          .map((line) => `${file}: ${line}`),
      );

    expect(references.length).toBeGreaterThan(0);
    expect(
      references.filter(
        (reference) =>
          !/: uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(
            reference,
          ),
      ),
    ).toEqual([]);
  });
});

describe("CI/CD 워크플로", () => {
  const ciCd = readWorkflow("ci-cd.yml");

  it.each([
    { change: "Cloudflare Worker", filter: "infra/**" },
    { change: "테스트가 읽는 .gitignore", filter: ".gitignore" },
  ])("$change만 바꾼 PR도 필수 검사를 건너뛰지 않는다", ({ filter }) => {
    const filters = [
      ...jobOf(ciCd, "changes").matchAll(/^\s+- '([^']+)'$/gm),
    ].map((match) => match[1]);
    expect(filters).toContain("src/**");
    expect(filters).toContain(filter);
  });

  describe("Cloud Run 배포", () => {
    const deployJob = (): string =>
      jobOf(ciCd, "deploy").replace(/\\\n\s*/g, "");

    it("새 리비전은 트래픽 없이 candidate 태그만 붙여 올린다", () => {
      const deploys = deployJob().match(/gcloud run deploy .*/g) ?? [];
      expect(deploys).toHaveLength(1);
      expect(deploys[0]).toMatch(/ --no-traffic( |$)/);
      expect(deploys[0]).toMatch(/ --tag[= ]candidate( |$)/);
    });

    it("candidate 주소의 상태 확인과 공개 읽기가 성공한 뒤에야 트래픽을 최신 리비전으로 옮긴다", () => {
      const deploy = deployJob();
      const steps = [
        /gcloud run deploy .*--no-traffic/,
        /select\(\.tag == "candidate"\)/,
        /curl -fsS .*"\$\{CANDIDATE_URL\}\/api\/health"/,
        /curl -fsS .*"\$\{CANDIDATE_URL\}\/api\/backgrounds"/,
        /gcloud run services update-traffic .*--to-latest/,
      ].map((pattern) => deploy.search(pattern));

      expect(steps).not.toContain(-1);
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
    });
  });
});
