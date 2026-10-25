import { getFirestore } from "#db";
import type { Bindings } from "./types";
import { createMediaStore } from "./lib/mediaStore";

let cached: Bindings | undefined;

/**
 * 프로세스 환경 변수로 API 바인딩을 만든다. 클라이언트와 저장소 연결은 프로세스 하나가
 * 함께 쓰므로 처음 한 번만 만든다.
 *
 * Cloud Run에서는 서비스 계정 자격으로 Firestore·GCS에 붙고, 비밀값은 Secret Manager에서
 * 환경 변수로 받는다. 로컬은 `.env.local`과 에뮬레이터(`FIRESTORE_EMULATOR_HOST`)를 쓴다.
 */
export function getServerEnv(): Bindings {
  cached ??= {
    DB: getFirestore(),
    MEDIA: createMediaStore(process.env),
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    KAKAO_CLIENT_ID: process.env.KAKAO_CLIENT_ID,
    KAKAO_CLIENT_SECRET: process.env.KAKAO_CLIENT_SECRET,
    NAVER_CLIENT_ID: process.env.NAVER_CLIENT_ID,
    NAVER_CLIENT_SECRET: process.env.NAVER_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  };
  return cached;
}
