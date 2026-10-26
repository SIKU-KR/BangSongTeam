import { afterEach, describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
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

function runScriptOf(job: string, stepName: string): string {
  const lines = job.split("\n");
  const step = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  expect(step).toBeGreaterThan(-1);
  const run = lines.findIndex(
    (line, index) => index > step && line.trim() === "run: |",
  );
  expect(run).toBeGreaterThan(-1);
  const indent = lines[run].indexOf("run:") + 2;
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && line.search(/\S/) < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

function findJq(): string | null {
  try {
    return execFileSync("sh", ["-c", "command -v jq"], { encoding: "utf-8" })
      .trim()
      .replace(/\/jq$/, "");
  } catch {
    return null;
  }
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
      const positions = [
        /gcloud run deploy .*--no-traffic/,
        /select\(\.tag == "candidate"\)/,
        /curl -fsS .*"\$\{CANDIDATE_URL\}\/api\/health"/,
        /curl -fsS .*"\$\{CANDIDATE_URL\}\/api\/backgrounds"/,
        /gcloud run services update-traffic .*--to-latest/,
      ].map((pattern) => deploy.search(pattern));

      expect(positions).not.toContain(-1);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));

      const steps = deploy.split(/\n(?= {6}- )/);
      const candidate = steps.findIndex((step) =>
        step.includes("gcloud run deploy "),
      );
      expect(candidate).toBeGreaterThan(0);
      expect(
        steps
          .slice(candidate)
          .filter((step) => /^\s*(?:- )?(?:if|continue-on-error):/m.test(step)),
      ).toEqual([]);
    });

    describe.skipIf(!findJq())("candidate 확인 스크립트", () => {
      const smokeScript = (): string =>
        runScriptOf(jobOf(ciCd, "deploy"), "Smoke test candidate revision");
      const workDirs: string[] = [];

      afterEach(() => {
        for (const dir of workDirs.splice(0)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });

      const plain = (name: string, value: string) => ({ name, value });
      const secret = (name: string, version: string) => ({
        name,
        valueFrom: { secretKeyRef: { name: "proxy-secret", key: version } },
      });

      function runSmoke(options: {
        env: object[];
        proxySecret?: string;
        serverRequires?: string;
      }) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-smoke-"));
        workDirs.push(dir);
        const files = {
          calls: path.join(dir, "calls.log"),
          service: path.join(dir, "service.json"),
          script: path.join(dir, "smoke.sh"),
        };
        fs.writeFileSync(
          files.service,
          JSON.stringify({
            spec: {
              template: { spec: { containers: [{ env: options.env }] } },
            },
            status: {
              traffic: [
                { revisionName: "svc-001", percent: 100 },
                {
                  tag: "candidate",
                  url: "https://candidate---svc-abc.asia-northeast3.run.app",
                  percent: 0,
                },
              ],
            },
          }),
        );
        fs.writeFileSync(files.script, smokeScript());
        const stub = (name: string, body: string) =>
          fs.writeFileSync(
            path.join(dir, name),
            `#!/usr/bin/env bash\necho "${name} $*" >> "$CALLS"\n${body}\n`,
            { mode: 0o755 },
          );
        stub(
          "gcloud",
          `case "$*" in
  "run services describe "*) cat "$SERVICE_JSON" ;;
  "secrets versions access "*) [ -n "\${PROXY_SECRET_VALUE-}" ] || exit 1; printf '%s' "$PROXY_SECRET_VALUE" ;;
  *) echo "unexpected gcloud $*" >&2; exit 64 ;;
esac`,
        );
        stub(
          "curl",
          `[ -n "\${SERVER_REQUIRES-}" ] || exit 0
url="\${!#}"
[ "\${url%/api/health}" != "$url" ] && exit 0
case "$*" in *"x-bst-proxy-secret: $SERVER_REQUIRES"*) ;; *) exit 22 ;; esac`,
        );

        const result = spawnSync(
          "/bin/bash",
          ["-eo", "pipefail", files.script],
          {
            encoding: "utf-8",
            env: {
              NODE_ENV: "test",
              PATH: [dir, findJq(), "/usr/bin", "/bin"].join(":"),
              SERVICE: "svc",
              REGION: "asia-northeast3",
              CALLS: files.calls,
              SERVICE_JSON: files.service,
              PROXY_SECRET_VALUE: options.proxySecret ?? "",
              SERVER_REQUIRES: options.serverRequires ?? "",
            },
          },
        );
        const calls = fs.existsSync(files.calls)
          ? fs.readFileSync(files.calls, "utf-8").split("\n").filter(Boolean)
          : [];
        return { ...result, calls };
      }

      it.each(["1", "true", "TRUE"])(
        "REQUIRE_PROXY=%s인 서비스는 proxy-secret을 읽어 공개 읽기 요청에만 비밀값 헤더를 붙인다",
        (flag) => {
          const result = runSmoke({
            env: [
              plain("MEDIA_BUCKET", "bucket"),
              secret("PROXY_SECRET", "3"),
              plain("REQUIRE_PROXY", flag),
            ],
            proxySecret: "s3cret",
            serverRequires: "s3cret",
          });

          expect(result.status).toBe(0);
          expect(result.calls).toContain(
            "gcloud secrets versions access 3 --secret=proxy-secret",
          );
          const health = result.calls.find((call) =>
            call.endsWith("/api/health"),
          );
          const backgrounds = result.calls.find((call) =>
            call.endsWith("/api/backgrounds"),
          );
          expect(health).toBeDefined();
          expect(health).not.toContain("x-bst-proxy-secret");
          expect(backgrounds).toContain("-H x-bst-proxy-secret: s3cret ");
          expect(result.stdout).toContain("::add-mask::s3cret");
        },
      );

      it.each([undefined, "", "0", "false"])(
        "REQUIRE_PROXY가 %j이면 비밀값을 읽지도 붙이지도 않는다",
        (flag) => {
          const result = runSmoke({
            env: [
              secret("PROXY_SECRET", "3"),
              ...(flag === undefined ? [] : [plain("REQUIRE_PROXY", flag)]),
            ],
          });

          expect(result.status).toBe(0);
          expect(result.calls.join("\n")).not.toMatch(
            /secrets|x-bst-proxy-secret/,
          );
          expect(
            result.calls.filter((call) => call.startsWith("curl ")),
          ).toHaveLength(2);
        },
      );

      it("켜진 서비스의 비밀값을 읽지 못하면 공개 읽기 확인에 가지 않고 실패한다", () => {
        const result = runSmoke({
          env: [secret("PROXY_SECRET", "3"), plain("REQUIRE_PROXY", "1")],
        });

        expect(result.status).not.toBe(0);
        expect(result.calls.join("\n")).not.toContain("/api/backgrounds");
      });

      it("서버가 비밀값을 요구하는데 값이 어긋나면 공개 읽기 확인이 실패한다", () => {
        const result = runSmoke({
          env: [secret("PROXY_SECRET", "3"), plain("REQUIRE_PROXY", "1")],
          proxySecret: "old-value",
          serverRequires: "s3cret",
        });

        expect(result.status).not.toBe(0);
      });
    });
  });
});
