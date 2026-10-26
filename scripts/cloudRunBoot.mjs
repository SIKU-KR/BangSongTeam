/**
 * Cloud Run 컨테이너의 진입점. 이미지에는 `server.js` 옆에 `boot.mjs`로 들어간다(`Dockerfile`).
 *
 * 운영에 꼭 필요한 환경 변수가 비어 있으면 Next.js 서버를 띄우지 않고 끝낸다. Next.js
 * standalone 서버는 포트를 먼저 열고 앱을 준비하므로, 설정이 빠진 리비전도 기본 TCP 시작
 * 확인을 통과해 트래픽을 받는다. 예를 들어 `gcloud run services update --set-env-vars`는 기존
 * 변수를 모두 바꿔, `MEDIA_BUCKET`이 빠지면 배경을 로컬 폴더에서 찾아 모두 404가 되고
 * `BETTER_AUTH_URL`이 빠지면 로그인이 깨진다. 여기서 끝내면 새 리비전이 준비되지 않아 이전
 * 리비전이 계속 서비스한다.
 *
 * 로컬 `pnpm start`(에뮬레이터·로컬 미디어 폴더)는 이 파일을 거치지 않는다.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REQUIRED_RUNTIME_ENV = [
  "MEDIA_BUCKET",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "PROXY_SECRET",
];

/** 운영 필수 환경 변수 중 비어 있는 이름. 공백만 있는 값도 비어 있는 것으로 본다. */
export function missingRuntimeEnv(env) {
  return REQUIRED_RUNTIME_ENV.filter((name) => !env[name]?.trim());
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const missing = missingRuntimeEnv(process.env);
  if (missing.length > 0) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        event: "missing_runtime_env",
        missing,
      }),
    );
    process.exit(1);
  }
  await import("./server.js");
}
