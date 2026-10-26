import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * `jq`가 있는 디렉터리. 셸 스크립트를 가짜 `gcloud`·`curl`로 돌려 보는 테스트는 진짜 `jq`로
 * 필터를 풀어야 하므로, 없으면 `null`을 돌려 그 테스트를 건너뛰게 한다.
 */
export function findJqDir(): string | null {
  try {
    const jq = execFileSync("sh", ["-c", "command -v jq"], {
      encoding: "utf-8",
    }).trim();
    return path.dirname(jq);
  } catch {
    return null;
  }
}

/**
 * 받은 인자를 `$CALLS` 파일에 한 줄로 남기고 `body`를 실행하는 가짜 실행 파일을 `dir`에 만든다.
 * `runWithStubs`가 `dir`을 `PATH` 맨 앞에 두므로 스크립트는 진짜 `gcloud`·`curl`에 닿지 못한다.
 */
export function writeStub(dir: string, name: string, body: string): void {
  fs.writeFileSync(
    path.join(dir, name),
    `#!/usr/bin/env bash\necho "${name} $*" >> "$CALLS"\n${body}\n`,
    { mode: 0o755 },
  );
}

export interface StubRun {
  status: number | null;
  stdout: string;
  stderr: string;
  /** 가짜 실행 파일이 받은 호출 (`이름 인자…`), 부른 순서대로 */
  calls: string[];
}

/**
 * 스크립트를 `dir`의 가짜 실행 파일과 `jq`, 기본 유틸리티만 보이는 `PATH`로 돌린다.
 * 운영 자원을 부르는 스크립트라, 가짜가 빠진 호출이 진짜 명령으로 새지 않게 `PATH`를 좁힌다.
 */
export function runWithStubs(
  script: string,
  dir: string,
  env: Record<string, string> = {},
): StubRun {
  const callsFile = path.join(dir, "calls.log");
  const result = spawnSync("/bin/bash", ["-eo", "pipefail", script], {
    encoding: "utf-8",
    env: {
      NODE_ENV: "test",
      PATH: [dir, findJqDir() ?? "", "/usr/bin", "/bin"].join(":"),
      CALLS: callsFile,
      ...env,
    },
  });
  const calls = fs.existsSync(callsFile)
    ? fs.readFileSync(callsFile, "utf-8").split("\n").filter(Boolean)
    : [];
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls,
  };
}
