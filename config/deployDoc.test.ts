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

function codeBlocks(text: string): string[] {
  return [...text.matchAll(/^```\w*\n([\s\S]*?)^```/gm)].map(
    (match) => match[1],
  );
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

  it("이미 만든 서비스를 고정하는 명령도 5절의 비밀값을 모두 적는다", () => {
    const pin = /--update-secrets\s+(\S*BETTER_AUTH_SECRET=\S+)/.exec(
      section(4),
    )?.[1];
    const pinned = (pin ?? "").split(",").map((entry) => entry.split("=")[0]);

    expect(pin).toBeDefined();
    expect(secretMappings().filter(({ env }) => !pinned.includes(env))).toEqual(
      [],
    );
  });

  it("REQUIRE_PROXY를 켠 서비스는 플래그를 끄는 명령에서 프록시 비밀값을 바꾸고 9절대로 다시 켠다", () => {
    const secrets = section(4);

    expect(secrets).toMatch(
      /^\s*gcloud run services update (?=.*--remove-env-vars REQUIRE_PROXY)(?=.*--update-secrets PROXY_SECRET=proxy-secret:)/m,
    );
    expect(secrets).toContain("9절대로 다시 켠다");
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

  it("이미 만든 데이터베이스에 켜는 명령과 일일 백업 일정을 함께 적는다", () => {
    const firestore = section(1);
    const update = firestore.search(
      /databases update .*--enable-pitr.*--delete-protection/,
    );

    expect(update).toBeGreaterThan(-1);
    expect(firestore.slice(update)).toMatch(
      /backups schedules create .*--recurrence=daily .*--retention=\d+d/,
    );
  });

  it("시점 복구와 백업 복구는 같은 복구본을 만들므로 따로 붙여 넣는 명령 묶음이다", () => {
    const blocks = codeBlocks(section(10));

    expect(blocks.some((block) => block.includes("databases clone"))).toBe(
      true,
    );
    expect(
      blocks.filter(
        (block) =>
          block.includes("databases clone") &&
          block.includes("databases restore"),
      ),
    ).toEqual([]);
  });

  it("옮길 id마다 그 사용자의 영구 삭제 기록을 먼저 지우고, 저장되지 않으면 멈춘다", () => {
    const restore = section(10);

    expect(read("src/db/collections.ts")).toContain(
      'driveTombstones: "driveTombstones"',
    );
    expect(restore).toContain("`driveTombstones`");
    expect(restore).toContain("deckTombstoneDocId");
    expect(restore).toContain("`saved`");
    expect(restore.indexOf("`driveTombstones`")).toBeLessThan(
      restore.indexOf("`upsertFolder`"),
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

  it("조건 변수는 공급자를 만들고 바꾸는 명령보다 먼저 정하고, 비면 만들거나 바꾸기 전에 멈춘다", () => {
    const identity = section(6);
    const defined = identity.indexOf("CONDITION=");

    expect(defined).toBeGreaterThan(-1);
    expect(defined).toBeLessThan(identity.indexOf("providers create-oidc"));
    expect(defined).toBeLessThan(identity.indexOf("providers update-oidc"));
    for (const command of ["create-oidc", "update-oidc"]) {
      expect(identity).toMatch(
        new RegExp(
          `: "\\$\\{CONDITION:\\?[^}]*\\}" &&\\s+gcloud [^\\n]*providers ${command}`,
        ),
      );
    }
  });

  it("저장소 id를 읽지 못하면 아무 토큰도 맞지 않는 조건을 만들지 않는다", () => {
    expect(section(6)).toMatch(
      /REPO_ID=\$\(gh api [^\n]+\n\[\[ \$REPO_ID =~ \^\[0-9\]\+\$ \]\] &&\s+CONDITION="/,
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
    expect(worker).toMatch(/비밀값 헤더가 없는\s+`\/api\/health`만 통과한다/);
  });

  it("알림 설정을 적용하는 스크립트가 있다", () => {
    expect(section(11)).toContain("infra/monitoring/apply.sh");
    expect(fs.existsSync(path.join(rootDir, "infra/monitoring/apply.sh"))).toBe(
      true,
    );
  });
});
