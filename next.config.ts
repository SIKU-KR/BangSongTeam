import type { NextConfig } from "next";

/**
 * - `output: "standalone"`: Cloud Run 컨테이너가 `node server.js` 하나로 뜨도록 필요한
 *   의존성만 `.next/standalone`에 모은다 (`Dockerfile`).
 * - Google Cloud 클라이언트는 실행 중에 proto 파일을 디스크에서 읽어 번들하면 깨진다.
 *   번들 밖 패키지로 두고 standalone 추적이 `node_modules`째 복사하게 한다.
 * - `NEXT_PUBLIC_APP_VERSION`: 클라이언트 실패 보고에 실을 앱 버전. CI 빌드는 커밋 SHA
 *   앞 7자리, 그 밖에서는 `dev`다.
 * - Cache Components를 켜지 않는다. 켜면 떠난 화면을 언마운트하지 않고 숨겨 두었다가
 *   돌아올 때 상태를 그대로 되살린다. 뒤로 가기로 다시 연 송출·편집 화면이 지난 위치·복귀
 *   경로·열린 대화 상자를 이어 가면 안 된다. 서버에서 가져오는 데이터가 없어 얻는 것도 없다.
 * - `/sw.js`는 매번 재검증해야 새 버전을 알아챈다.
 */
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@google-cloud/firestore", "@google-cloud/storage"],
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

export default config;
