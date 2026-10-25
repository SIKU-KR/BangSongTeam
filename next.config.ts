import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { BACKGROUND_INDEX_NAMES } from "./src/shared/utils/backgroundEmbedding";

interface WranglerVectorizeBinding {
  index_name: string;
}

/**
 * `CF_REMOTE_BINDINGS=true`로 원격 Workers AI·Vectorize를 붙일 때 쓰는 개발용 wrangler 설정.
 * 로컬 D1의 배경 id는 운영 인덱스에 없으므로 배경 인덱스를 로컬용으로 바꾼다. 배포 설정은
 * 운영 인덱스를 그대로 쓴다.
 */
function writeDevWranglerConfig(): string {
  const source = readFileSync(path.resolve("wrangler.jsonc"), "utf-8");
  const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, "")) as {
    vectorize?: WranglerVectorizeBinding[];
  };
  for (const index of config.vectorize ?? []) {
    index.index_name = BACKGROUND_INDEX_NAMES.local;
  }
  const out = path.resolve(".wrangler/dev-wrangler.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(config, null, 2));
  return out;
}

/**
 * `next dev`·`next start`에서 `getCloudflareContext()`가 로컬 D1·R2 바인딩과 `.dev.vars`
 * 비밀값을 받게 한다. 배포된 Worker는 바인딩을 런타임에서 직접 받는다.
 * 원격 바인딩은 기본으로 끈다. 켜 두면 `CLOUDFLARE_API_TOKEN`이 없는 사람은 로컬 개발을
 * 시작하지 못한다.
 */
async function initCloudflareBindingsForDev(): Promise<void> {
  const remoteBindings = process.env.CF_REMOTE_BINDINGS === "true";
  await initOpenNextCloudflareForDev({
    remoteBindings,
    ...(remoteBindings ? { configPath: writeDevWranglerConfig() } : {}),
  });
}

/**
 * - `NEXT_PUBLIC_APP_VERSION`: 클라이언트 실패 보고에 실을 앱 버전. CI 빌드는 커밋 SHA
 *   앞 7자리, 그 밖에서는 `dev`다.
 * - Cache Components를 켜지 않는다. 켜면 떠난 화면을 언마운트하지 않고 숨겨 두었다가
 *   돌아올 때 상태를 그대로 되살린다. 뒤로 가기로 다시 연 송출·편집 화면이 지난 위치·복귀
 *   경로·열린 대화 상자를 이어 가면 안 된다. 서버에서 가져오는 데이터가 없어 얻는 것도 없다.
 * - `/sw.js`는 매번 재검증해야 새 버전을 알아챈다.
 */
export default async function config(phase: string): Promise<NextConfig> {
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_SERVER) {
    await initCloudflareBindingsForDev();
  }

  return {
    typescript: { tsconfigPath: "tsconfig.app.json" },
    env: {
      NEXT_PUBLIC_APP_VERSION: process.env.GITHUB_SHA?.slice(0, 7) ?? "dev",
    },
    turbopack: {
      rules: {
        "*.css": {
          loaders: ["@tailwindcss/turbopack"],
          as: "*.css",
        },
      },
    },
    async headers() {
      return [
        {
          source: "/sw.js",
          headers: [
            {
              key: "Cache-Control",
              value: "no-cache, no-store, must-revalidate",
            },
          ],
        },
      ];
    },
  };
}
