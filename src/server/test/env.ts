import { createMemoryMediaStore } from "../lib/mediaStore";
import { createTestDb } from "../../db/test/fixtures";
import type { Bindings } from "../types";

/**
 * 테스트 파일마다 쓰는 API 바인딩. Firestore는 이 파일 전용 에뮬레이터 프로젝트라 다른
 * 테스트 파일과 데이터를 나누지 않는다. 같은 파일 안의 테스트는 `clearDb(env.DB)`로 비운다.
 */
export const env = {
  DB: createTestDb(),
  MEDIA: createMemoryMediaStore(),
  BETTER_AUTH_SECRET: "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
  BETTER_AUTH_URL: "http://localhost:5173",
  KAKAO_CLIENT_ID: "",
  KAKAO_CLIENT_SECRET: "",
  NAVER_CLIENT_ID: "",
  NAVER_CLIENT_SECRET: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
} satisfies Bindings;
