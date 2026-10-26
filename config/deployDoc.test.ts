import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const rootDir = path.resolve(__dirname, "..");
const read = (file: string): string =>
  fs.readFileSync(path.join(rootDir, file), "utf-8");

const doc = read("docs/deploy-gcp.md");

function section(number: number): string {
  const start = doc.search(new RegExp(`^## ${number}\\. `, "m"));
  expect(start).toBeGreaterThan(-1);
  const rest = doc.slice(start + 1);
  const end = rest.search(/^## \d+\. /m);
  return (end === -1 ? rest : rest.slice(0, end)).replace(/\\\n\s*/g, " ");
}

function secretMappings(): { env: string; secret: string; version: string }[] {
  const mapping = /--set-secrets "([^"]+)"/.exec(section(5))?.[1] ?? "";
  return mapping.split(",").map((entry) => {
    const [env, reference] = entry.split("=");
    const [secret, version] = reference.split(":");
    return { env, secret, version };
  });
}

describe("배포 문서의 서비스 설정", () => {
  it("Cloud Run에 붙이는 비밀값은 모두 버전 번호로 고정한다", () => {
    const mappings = secretMappings();

    expect(mappings.length).toBeGreaterThan(0);
    expect(mappings.filter(({ version }) => !/^\d+$/.test(version))).toEqual(
      [],
    );
  });

  it("서비스가 참조하는 비밀값을 모두 4절에서 만든다", () => {
    const created = [
      ...section(4).matchAll(/gcloud secrets create ([a-z0-9-]+)/g),
    ].map((match) => match[1]);

    expect(
      secretMappings().filter(({ secret }) => !created.includes(secret)),
    ).toEqual([]);
  });

  it("비밀값 환경 변수는 서버가 실제로 읽는 이름이다", () => {
    const serverEnv = read("src/server/env.ts");

    expect(
      secretMappings().filter(
        ({ env }) => !serverEnv.includes(`process.env.${env}`),
      ),
    ).toEqual([]);
  });

  it("새 프로젝트에서 Worker가 가리킬 원본 주소를 바꾸는 방법을 적는다", () => {
    const worker = section(9);

    expect(read("infra/cloudflare-proxy/wrangler.jsonc")).toContain(
      '"ORIGIN_HOST"',
    );
    expect(worker).toContain("ORIGIN_HOST");
    expect(worker).toContain("projectNumber");
    expect(worker).toContain("wrangler secret put PROXY_SECRET");
  });
});

describe("배포 문서의 Firestore 복구 수단", () => {
  it("데이터베이스는 시점 복구와 삭제 방지를 켜서 만들고 일일 백업을 둔다", () => {
    const firestore = section(1);

    expect(firestore).toMatch(
      /databases create .*--enable-pitr.*--delete-protection/,
    );
    expect(firestore).toMatch(
      /backups schedules create .*--recurrence=daily .*--retention=\d+d/,
    );
  });

  it("이미 만든 데이터베이스에 켜는 명령을 적는다", () => {
    expect(section(1)).toMatch(
      /databases update .*--enable-pitr.*--delete-protection/,
    );
  });

  it("복구는 별도 데이터베이스로 하고 앱의 쓰기 함수로만 운영 데이터에 옮긴다", () => {
    const restore = section(10);

    expect(restore).toMatch(/databases clone .*--destination-database=/);
    expect(restore).toMatch(/databases restore .*--destination-database=/);
    for (const [file, name] of [
      ["folders", "upsertFolder"],
      ["presentations", "savePresentationChanges"],
      ["decks", "upsertDeck"],
    ]) {
      expect(restore).toContain(name);
      expect(read(`src/db/queries/${file}.ts`)).toContain(
        `export async function ${name}(`,
      );
    }
  });
});

describe("배포 문서의 Workload Identity", () => {
  const condition = (): string =>
    /CONDITION="([^"]+)"/.exec(section(6))?.[1] ?? "";

  it("배포 계정은 main 브랜치의 ci-cd.yml 워크플로만 받을 수 있다", () => {
    expect(condition()).toContain("assertion.repository_id==");
    expect(condition()).toContain("assertion.ref=='refs/heads/main'");
    expect(condition()).toContain(
      "assertion.workflow_ref=='SIKU-KR/BangSongTeam/.github/workflows/ci-cd.yml@refs/heads/main'",
    );
    expect(
      fs.existsSync(path.join(rootDir, ".github/workflows/ci-cd.yml")),
    ).toBe(true);
  });

  it("새 공급자와 이미 만든 공급자 모두 같은 조건을 쓴다", () => {
    const identity = section(6);

    expect(identity).toMatch(
      /providers create-oidc .*--attribute-condition="\$CONDITION"/,
    );
    expect(identity).toMatch(
      /providers update-oidc .*--attribute-condition="\$CONDITION"/,
    );
  });
});

describe("배포 문서의 운영 선택 사항", () => {
  it("REQUIRE_PROXY는 서버가 읽는 이름이고 켜고 끄는 방법을 적는다", () => {
    const worker = section(9);

    expect(read("src/server/env.ts")).toContain("process.env.REQUIRE_PROXY");
    expect(worker).toMatch(/--update-env-vars REQUIRE_PROXY=1/);
    expect(worker).toMatch(/--remove-env-vars REQUIRE_PROXY/);
    expect(worker).toContain("secretmanager.secretAccessor");
  });

  it("알림 설정을 적용하는 스크립트가 있다", () => {
    expect(section(11)).toContain("infra/monitoring/apply.sh");
    expect(fs.existsSync(path.join(rootDir, "infra/monitoring/apply.sh"))).toBe(
      true,
    );
  });
});
