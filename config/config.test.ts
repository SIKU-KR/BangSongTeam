import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const rootDir = path.resolve(__dirname, "..");
const read = (file: string) =>
  fs.readFileSync(path.join(rootDir, file), "utf-8");

describe("Next.js·Cloud Run 프로젝트 설정", () => {
  it("package.json이 필수 의존성·스크립트와 레이어 import 별칭을 갖는다", () => {
    const pkg = JSON.parse(read("package.json"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const dep of [
      "hono",
      "@hono/zod-validator",
      "zod",
      "@google-cloud/firestore",
      "@google-cloud/storage",
      "firebase-tools",
    ]) {
      expect(allDeps).toHaveProperty(dep);
    }
    for (const dep of ["wrangler", "drizzle-orm", "@opennextjs/cloudflare"]) {
      expect(allDeps).not.toHaveProperty(dep);
    }

    expect(pkg.imports).toEqual({
      "#shared": "./src/shared/index.ts",
      "#db": "./src/db/index.ts",
      "#components/*": "./src/client/components/*.tsx",
      "#lib/*": "./src/client/lib/*.ts",
      "#hooks/*": "./src/client/hooks/*.ts",
      "#copy/*": "./src/client/copy/*.ts",
    });
    for (const target of Object.values<string>(pkg.imports)) {
      const existing = target.includes("*") ? path.dirname(target) : target;
      expect(fs.existsSync(path.join(rootDir, existing))).toBe(true);
    }

    expect(pkg.scripts.dev).toContain("next dev");
    expect(pkg.scripts.build).toContain("next build");
    expect(pkg.scripts.build).toContain("scripts/buildServiceWorker.mjs");
    expect(pkg.scripts.emulators).toContain("scripts/emulators.mjs");
  });

  it("standalone으로 빌드하고 Google Cloud 클라이언트는 번들하지 않는다", async () => {
    const { default: config } = await import("../next.config");
    expect(config.output).toBe("standalone");
    expect(config.serverExternalPackages).toEqual(
      expect.arrayContaining([
        "@google-cloud/firestore",
        "@google-cloud/storage",
      ]),
    );
  });

  it("Dockerfile이 standalone 서버와 정적 파일을 담아 8080에서 띄운다", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("pnpm build");
    expect(dockerfile).toContain("/app/.next/standalone");
    expect(dockerfile).toContain("/app/.next/static ./.next/static");
    expect(dockerfile).toContain("/app/public ./public");
    expect(dockerfile).toMatch(/PORT=8080/);
    expect(dockerfile).toContain('CMD ["server.js"]');
    expect(read(".dockerignore")).toMatch(/^\.data$/m);
  });
});

describe("Firestore 설정", () => {
  const indexes = JSON.parse(read("firestore.indexes.json")) as {
    indexes: {
      collectionGroup: string;
      fields: { fieldPath: string; order?: string; arrayConfig?: string }[];
    }[];
  };

  it("공유 라이브러리 정렬·검색 쿼리에 맞는 복합 색인이 있다", () => {
    const fieldsOf = (paths: string[]) =>
      indexes.indexes.find(
        (index) =>
          index.collectionGroup === "decks" &&
          index.fields.map((field) => field.fieldPath).join() === paths.join(),
      );
    expect(fieldsOf(["listed", "forkCount", "updatedAt"])?.fields).toEqual([
      { fieldPath: "listed", order: "ASCENDING" },
      { fieldPath: "forkCount", order: "DESCENDING" },
      { fieldPath: "updatedAt", order: "DESCENDING" },
    ]);
    expect(
      fieldsOf(["listed", "searchGrams", "forkCount", "updatedAt"])?.fields[1],
    ).toEqual({ fieldPath: "searchGrams", arrayConfig: "CONTAINS" });
  });

  it("브라우저 SDK의 직접 읽기·쓰기를 모두 막는다", () => {
    const rules = read("firestore.rules");
    expect(rules).toContain("allow read, write: if false;");
    expect(rules).not.toMatch(/if true/);
  });

  it("firebase.json이 규칙·색인과 에뮬레이터를 가리킨다", () => {
    const firebase = JSON.parse(read("firebase.json"));
    expect(firebase.firestore).toEqual({
      rules: "firestore.rules",
      indexes: "firestore.indexes.json",
    });
    expect(firebase.emulators.firestore.port).toBe(8080);
    expect(firebase.emulators.singleProjectMode).toBe(false);
  });
});

describe("로컬 개발용 환경 변수 템플릿", () => {
  it("config/env.example이 필요한 환경 변수를 모두 담는다", () => {
    const content = read("config/env.example");
    for (const key of [
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "FIRESTORE_EMULATOR_HOST",
      "GOOGLE_CLOUD_PROJECT",
      "MEDIA_DIR",
      "KAKAO_CLIENT_ID",
      "KAKAO_CLIENT_SECRET",
      "NAVER_CLIENT_ID",
      "NAVER_CLIENT_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
    ]) {
      expect(content).toMatch(new RegExp(`^${key}=`, "m"));
    }
    expect(content).toMatch(/^GOOGLE_CLOUD_PROJECT=demo-/m);
  });
});

describe("GitHub Actions CI/CD 워크플로우 설정", () => {
  const content = read(".github/workflows/ci-cd.yml");

  it("앱 기능 외 파일 변경 시 검증을 건너뛰도록 구성된다", () => {
    expect(content).toContain("name: CI/CD");
    expect(content).toContain("paths-ignore:");
    expect(content).toContain("docs/**");
    expect(content).toContain("**.md");
    expect(content).toContain(".gitignore");
    expect(content).toContain(".prettierignore");
    expect(content).toContain("config/env.example");
    expect(content).toContain("dorny/paths-filter");
    expect(content).toContain("Typecheck, Lint & Test");
    expect(content).toContain("Deploy to Cloud Run");
  });

  it("테스트가 쓰는 Firestore 에뮬레이터용 Java를 준비한다", () => {
    expect(content).toContain("actions/setup-java");
    expect(content).toMatch(/java-version: 21/);
  });

  it("changes 잡이 건너뛰어진 main push에서도 배포 잡이 실행되고, 프로젝트 설정 전에는 배포하지 않는다", () => {
    const deployJob = content.slice(content.indexOf("\n  deploy:"));
    expect(deployJob).toMatch(
      /if: always\(\) && needs\.verify\.result == 'success'.*vars\.GCP_PROJECT_ID != ''/,
    );
    expect(deployJob).toContain("id-token: write");
    expect(deployJob).toContain("firebase deploy --only firestore");
    expect(deployJob).toContain("gcloud run deploy");
  });
});
