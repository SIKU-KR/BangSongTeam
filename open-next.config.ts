import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Cloudflare Workers 배포용 OpenNext 설정.
 *
 * 증분 캐시를 두지 않는다. 서버는 어느 화면이든 로딩 화면만 그려 렌더 비용이 작고, 화면
 * HTML은 서비스 워커가 프리캐시한 셸로 답한다. 빌드는 `pnpm build`가 서비스 워커까지 만든다.
 */
const config = {
  ...defineCloudflareConfig(),
  buildCommand: "pnpm build",
};

export default config;
