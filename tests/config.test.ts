import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Task 4.1: Cloudflare Worker 프로젝트 설정 및 Wrangler 바인딩 구성", () => {
  const rootDir = path.resolve(__dirname, "..");
  const webDir = path.join(rootDir, "apps/web");
  const packageJsonPath = path.join(webDir, "package.json");
  const wranglerJsoncPath = path.join(webDir, "wrangler.jsonc");
  const workerConfigDtsPath = path.join(webDir, "worker-configuration.d.ts");

  it("apps/web/package.json exists and contains required dependencies and scripts", () => {
    expect(fs.existsSync(packageJsonPath)).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    expect(pkg.name).toBe("web");

    // Required dependencies
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    expect(allDeps).toHaveProperty("hono");
    expect(allDeps).toHaveProperty("@hono/zod-validator");
    expect(allDeps).toHaveProperty("@repo/shared");
    expect(allDeps).toHaveProperty("@repo/db");

    // scripts
    expect(pkg.scripts).toHaveProperty("dev");
    expect(pkg.scripts).toHaveProperty("deploy");
    expect(pkg.scripts).toHaveProperty("types");
    expect(pkg.scripts.types).toContain("wrangler types");
  });

  it("apps/web/wrangler.jsonc exists and defines main entrypoint, D1 and R2 bindings", () => {
    expect(fs.existsSync(wranglerJsoncPath)).toBe(true);

    const content = fs.readFileSync(wranglerJsoncPath, "utf-8");
    // Strip single-line comments for JSON parsing
    const cleanJson = content.replace(/\/\/.*$/gm, "");
    const config = JSON.parse(cleanJson);

    // main entrypoint
    expect(config.main).toBe("worker/index.ts");

    // D1 binding DB
    expect(config.d1_databases).toBeDefined();
    const d1Db = config.d1_databases.find(
      (d: { binding: string }) => d.binding === "DB",
    );
    expect(d1Db).toBeDefined();

    // R2 binding MEDIA_BUCKET
    expect(config.r2_buckets).toBeDefined();
    const r2Bucket = config.r2_buckets.find(
      (b: { binding: string }) => b.binding === "MEDIA_BUCKET",
    );
    expect(r2Bucket).toBeDefined();

    // Workers AI(LLM 가사 정규화)는 MVP에서 뺐다
    expect(config.ai).toBeUndefined();
  });

  it("worker-configuration.d.ts is generated and includes required bindings", () => {
    expect(fs.existsSync(workerConfigDtsPath)).toBe(true);

    const dtsContent = fs.readFileSync(workerConfigDtsPath, "utf-8");
    expect(dtsContent).toContain("DB: D1Database");
    expect(dtsContent).toContain("MEDIA_BUCKET: R2Bucket");
    expect(dtsContent).not.toContain("AI: Ai");
  });
});

describe("Task 4.2: 로컬 Miniflare 개발용 환경 변수 템플릿 작성", () => {
  const rootDir = path.resolve(__dirname, "..");
  const webDir = path.join(rootDir, "apps/web");
  const devVarsExamplePath = path.join(webDir, ".dev.vars.example");

  it(".dev.vars.example exists and contains all required environment variables", () => {
    expect(fs.existsSync(devVarsExamplePath)).toBe(true);

    const content = fs.readFileSync(devVarsExamplePath, "utf-8");
    const requiredKeys = [
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "KAKAO_CLIENT_ID",
      "KAKAO_CLIENT_SECRET",
      "NAVER_CLIENT_ID",
      "NAVER_CLIENT_SECRET",
      "R2_PUBLIC_DOMAIN",
    ];

    for (const key of requiredKeys) {
      expect(content).toMatch(new RegExp(`^${key}=`, "m"));
    }
  });
});
