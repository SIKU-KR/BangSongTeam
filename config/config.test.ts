import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import loadCustomRoutes from "next/dist/lib/load-custom-routes";
import { configSchema } from "next/dist/server/config-schema";
import { buildCustomRoute } from "next/dist/server/lib/router-utils/filesystem";
import nextConfig from "../next.config";

const rootDir = path.resolve(__dirname, "..");
const read = (file: string) =>
  fs.readFileSync(path.join(rootDir, file), "utf-8");

async function responseHeadersFor(
  pathname: string,
): Promise<Record<string, string>> {
  const { headers: rules } = await loadCustomRoutes(nextConfig);
  const headers: Record<string, string> = {};
  for (const rule of rules) {
    if (!buildCustomRoute("header", rule).match(pathname)) continue;
    for (const { key, value } of rule.headers) {
      headers[key.toLowerCase()] = value;
    }
  }
  return headers;
}

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

  it("주소마다 렌더한 화면 캐시를 파일로 쓰지 않는다 (Cloud Run 파일 시스템은 메모리다)", () => {
    expect(nextConfig.experimental?.isrFlushToDisk).toBe(false);
  });

  it("쓰지 않는 이미지 최적화 경로(/_next/image)를 닫는다", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });

  it("Next.js가 아는 옵션만 쓴다 (모르는 옵션은 빌드가 경고만 하고 무시한다)", () => {
    expect(configSchema.safeParse(nextConfig).error?.issues ?? []).toEqual([]);
  });

  describe("클라이언트 실패 보고에 싣는 앱 버전", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each([
      [undefined, "dev"],
      ["", "dev"],
      ["3a0fbb1c0ffee", "3a0fbb1"],
    ])("GITHUB_SHA가 %j이면 %s다", async (sha, version) => {
      vi.stubEnv("GITHUB_SHA", sha);
      vi.resetModules();
      const { default: config } = await import("../next.config");
      expect(config.env?.NEXT_PUBLIC_APP_VERSION).toBe(version);
    });
  });

  it("Dockerfile이 standalone 서버와 정적 파일을 담아 8080에서 띄운다", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("pnpm build");
    expect(dockerfile).toContain("/app/.next/standalone");
    expect(dockerfile).toContain("/app/.next/static ./.next/static");
    expect(dockerfile).toContain("/app/public ./public");
    expect(dockerfile).toMatch(/PORT=8080/);
    expect(read(".dockerignore")).toMatch(/^\.data$/m);
  });

  it("Dockerfile은 운영 필수 환경 변수를 확인하는 boot.mjs로 서버를 띄운다", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain(
      "COPY --from=build --chown=nonroot:nonroot /app/scripts/cloudRunBoot.mjs ./boot.mjs",
    );
    expect(dockerfile).toContain('CMD ["boot.mjs"]');
    expect(dockerfile).not.toContain('CMD ["server.js"]');
  });

  it("google-github-actions/auth가 작업 공간에 쓰는 자격 증명 파일을 이미지 빌드와 커밋에서 뺀다", () => {
    const lines = (file: string) =>
      read(file)
        .split("\n")
        .map((line) => line.trim());
    expect(lines(".dockerignore")).toContain("gha-creds-*.json");
    expect(lines(".gitignore")).toContain("gha-creds-*.json");
  });
});

describe("응답 보안 헤더", () => {
  const CSP = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";

  it("X-Powered-By를 보내지 않는다", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it.each([
    "/",
    "/presentations",
    "/editor/abc_DEF-123",
    "/present/abc/fullscreen",
    "/api/presentations",
    "/api/media/loops/a.mp4",
    "/sw.js",
    "/_next/static/chunks/main.js",
  ])("%s 응답에 보안 헤더를 붙인다", async (pathname) => {
    expect(await responseHeadersFor(pathname)).toMatchObject({
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-frame-options": "DENY",
      "content-security-policy": CSP,
      "strict-transport-security": "max-age=31536000",
    });
  });

  it("공유 링크 화면은 Referer로 링크 토큰을 내보내지 않는다", async () => {
    expect(await responseHeadersFor("/s/abc_DEF-123")).toMatchObject({
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": CSP,
    });
  });

  it("보안 헤더가 /sw.js의 재검증 헤더를 덮지 않는다", async () => {
    expect((await responseHeadersFor("/sw.js"))["cache-control"]).toBe(
      "no-cache, no-store, must-revalidate",
    );
  });
});

describe("Firestore 설정", () => {
  const indexes = JSON.parse(read("firestore.indexes.json")) as {
    fieldOverrides: {
      collectionGroup: string;
      fieldPath: string;
      ttl?: boolean;
      indexes: { order?: string; queryScope?: string }[];
    }[];
  };

  it("만료된 OAuth state는 콜백 대신 TTL 정책이 지우고, 만료 시각 범위 조회는 그대로 된다", () => {
    const expiresAt = indexes.fieldOverrides.find(
      (field) =>
        field.collectionGroup === "verifications" &&
        field.fieldPath === "expiresAt",
    );

    expect(expiresAt?.ttl).toBe(true);
    expect(expiresAt?.indexes).toEqual([
      { order: "ASCENDING", queryScope: "COLLECTION" },
      { order: "DESCENDING", queryScope: "COLLECTION" },
    ]);
  });

  it("지난 날의 이메일 가입 한도 문서는 TTL 정책이 지우고 만료 시각은 색인하지 않는다", () => {
    const expiresAt = indexes.fieldOverrides.find(
      (field) =>
        field.collectionGroup === "signUpQuotas" &&
        field.fieldPath === "expiresAt",
    );

    expect(expiresAt).toEqual({
      collectionGroup: "signUpQuotas",
      fieldPath: "expiresAt",
      ttl: true,
      indexes: [],
    });
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
