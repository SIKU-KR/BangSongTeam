import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const rootDir = path.resolve(__dirname, "..");

describe("Cloudflare Worker 프로젝트 설정과 Wrangler 바인딩", () => {
  const packageJsonPath = path.join(rootDir, "package.json");
  const wranglerJsoncPath = path.join(rootDir, "wrangler.jsonc");
  const workerConfigDtsPath = path.join(
    rootDir,
    "src/worker/worker-configuration.d.ts",
  );

  it("package.json이 필수 의존성·스크립트와 레이어 import 별칭을 갖는다", () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    expect(allDeps).toHaveProperty("hono");
    expect(allDeps).toHaveProperty("@hono/zod-validator");
    expect(allDeps).toHaveProperty("drizzle-orm");
    expect(allDeps).toHaveProperty("zod");

    expect(pkg.imports).toEqual({
      "#shared": "./src/shared/index.ts",
      "#db": "./src/db/index.ts",
      "#components/*": "./src/client/components/*.tsx",
      "#lib/*": "./src/client/lib/*.ts",
      "#hooks/*": "./src/client/hooks/*.ts",
    });
    for (const target of Object.values<string>(pkg.imports)) {
      const existing = target.includes("*") ? path.dirname(target) : target;
      expect(fs.existsSync(path.join(rootDir, existing))).toBe(true);
    }

    expect(pkg.scripts).toHaveProperty("dev");
    expect(pkg.scripts).toHaveProperty("deploy");
    expect(pkg.scripts).toHaveProperty("types");
    expect(pkg.scripts.types).toContain("wrangler types");
  });

  it("wrangler.jsonc가 Worker 진입점, D1·R2 바인딩, 마이그레이션 경로를 정의한다", () => {
    const content = fs.readFileSync(wranglerJsoncPath, "utf-8");
    const cleanJson = content.replace(/^\s*\/\/.*$/gm, "");
    const config = JSON.parse(cleanJson);

    expect(config.main).toBe("src/worker/index.ts");
    expect(fs.existsSync(path.join(rootDir, config.main))).toBe(true);

    const d1Db = config.d1_databases.find(
      (d: { binding: string }) => d.binding === "DB",
    );
    expect(d1Db).toBeDefined();
    expect(
      fs.existsSync(
        path.join(rootDir, d1Db.migrations_dir, "0001_initial.sql"),
      ),
    ).toBe(true);

    const r2Bucket = config.r2_buckets.find(
      (b: { binding: string }) => b.binding === "MEDIA_BUCKET",
    );
    expect(r2Bucket).toBeDefined();

    expect(config.ai).toBeUndefined();
  });

  it("worker-configuration.d.ts가 생성되어 있고 필수 바인딩을 포함한다", () => {
    const dtsContent = fs.readFileSync(workerConfigDtsPath, "utf-8");
    expect(dtsContent).toContain("DB: D1Database");
    expect(dtsContent).toContain("MEDIA_BUCKET: R2Bucket");
    expect(dtsContent).not.toContain("AI: Ai");
  });
});

describe("로컬 개발용 환경 변수 템플릿", () => {
  it(".dev.vars.example이 필요한 환경 변수를 모두 담는다", () => {
    const content = fs.readFileSync(
      path.join(rootDir, ".dev.vars.example"),
      "utf-8",
    );
    const requiredKeys = [
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "KAKAO_CLIENT_ID",
      "KAKAO_CLIENT_SECRET",
      "NAVER_CLIENT_ID",
      "NAVER_CLIENT_SECRET",
    ];

    for (const key of requiredKeys) {
      expect(content).toMatch(new RegExp(`^${key}=`, "m"));
    }
    expect(content).not.toMatch(/^R2_PUBLIC_DOMAIN=/m);
  });
});

describe("GitHub Actions CI/CD 워크플로우 설정", () => {
  it("ci-cd.yml이 앱 기능 외 파일 변경 시 검증을 건너뛰도록 구성된다", () => {
    const workflowPath = path.join(rootDir, ".github/workflows/ci-cd.yml");
    const content = fs.readFileSync(workflowPath, "utf-8");

    expect(content).toContain("name: CI/CD");
    expect(content).toContain("paths-ignore:");
    expect(content).toContain("docs/**");
    expect(content).toContain("**.md");
    expect(content).toContain(".gitignore");
    expect(content).toContain(".prettierignore");
    expect(content).toContain(".dev.vars.example");
    expect(content).toContain("dorny/paths-filter");
    expect(content).toContain("Typecheck, Lint & Test");
    expect(content).toContain("Migrate D1 & Deploy Worker");
  });

  it("changes 잡이 건너뛰어진 main push에서도 배포 잡이 실행된다", () => {
    const workflowPath = path.join(rootDir, ".github/workflows/ci-cd.yml");
    const content = fs.readFileSync(workflowPath, "utf-8");
    const deployJob = content.slice(content.indexOf("\n  deploy:"));

    expect(deployJob).toMatch(
      /if: always\(\) && needs\.verify\.result == 'success'/,
    );
  });
});
