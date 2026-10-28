import type { NextConfig } from "next";

/**
 * - `output: "standalone"`: Cloud Run 컨테이너가 standalone 출력만으로 뜨도록 필요한
 *   의존성만 `.next/standalone`에 모은다 (`Dockerfile`).
 * - Google Cloud 클라이언트는 실행 중에 proto 파일을 디스크에서 읽어 번들하면 깨진다.
 *   `@node-rs/argon2`는 플랫폼별 `.node` 바이너리를 불러오므로 같은 이유로 번들하지 않는다.
 *   번들 밖 패키지로 두고 standalone 추적이 `node_modules`째 복사하게 한다.
 * - `NEXT_PUBLIC_APP_VERSION`: 클라이언트 실패 보고에 실을 앱 버전. CI 빌드는 커밋 SHA
 *   앞 7자리, 그 밖에서는 `dev`다.
 * - Cache Components를 켜지 않는다. 켜면 떠난 화면을 언마운트하지 않고 숨겨 두었다가
 *   돌아올 때 상태를 그대로 되살린다. 뒤로 가기로 다시 연 송출·편집 화면이 지난 위치·복귀
 *   경로·열린 대화 상자를 이어 가면 안 된다. 서버에서 가져오는 데이터가 없어 얻는 것도 없다.
 * - `experimental.isrFlushToDisk: false`: 동적 경로 화면은 주소마다 렌더해 캐시에 담는다.
 *   Cloud Run의 파일 시스템은 인스턴스 메모리라 파일로 쓰면 처음 보는 id마다 쌓이고 지워지지
 *   않아, 무작위 주소 요청만으로 인스턴스를 메모리 부족으로 죽일 수 있다. 크기가 정해진 메모리
 *   캐시(`cacheMaxMemorySize`, 기본 50MB)에만 둔다. 빌드 때 미리 렌더한 셸은 그대로 읽는다.
 * - `images.unoptimized`: next/image를 쓰지 않으므로 `/_next/image`를 닫는다(404). 열어 두면
 *   누구나 `/api/media` 영상을 요청마다 50MB까지 서버 메모리로 끌어오게 하고, 주소 변형마다
 *   변환 결과를 메모리 파일 시스템에 캐시하게 할 수 있다.
 * - `poweredByHeader: false`: `X-Powered-By: Next.js`로 서버 구성을 알리지 않는다.
 * - 모든 응답에 보안 헤더를 붙인다. 같은 헤더는 뒤 규칙이 앞 규칙을 덮는다.
 *   - `X-Frame-Options: DENY`와 CSP `frame-ancestors 'none'`: 다른 페이지가 앱을 프레임에
 *     넣지 못하게 한다. 앱은 프레임을 쓰지 않는다.
 *   - CSP는 `base-uri`·`object-src`만 제한하고 `script-src`는 두지 않는다. 미리 렌더한 셸에
 *     인라인 RSC 스크립트가 있고, 셸을 프리캐시해 요청마다 바뀌는 nonce도 쓸 수 없다.
 *   - `Referrer-Policy`: 다른 출처에는 출처만 보낸다. 브라우저 기본값에 맡기면 오래된
 *     브라우저는 전체 주소를 보낸다. 공유 링크 화면(`/s/:token`)은 `no-referrer`로 링크 토큰이
 *     Referer에 실리지 않게 한다.
 *   - `X-Content-Type-Options: nosniff`: 응답을 선언한 Content-Type으로만 해석하게 한다.
 *   - `Strict-Transport-Security`: 한 번 연 브라우저는 1년 동안 HTTPS로만 연다.
 * - `/sw.js`는 매번 재검증해야 새 버전을 알아챈다.
 */
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@google-cloud/firestore",
    "@google-cloud/storage",
    "@node-rs/argon2",
  ],
  typescript: { tsconfigPath: "tsconfig.app.json" },
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.GITHUB_SHA?.slice(0, 7) ?? "dev",
  },
  experimental: { isrFlushToDisk: false },
  images: { unoptimized: true },
  poweredByHeader: false,
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
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
          },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
      {
        source: "/s/:token*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
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
