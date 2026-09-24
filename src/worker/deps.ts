import {
  createOptionalSession,
  createRequireAuth,
  readSessionFromBetterAuth,
  type SessionReader,
} from "./middleware/auth";

/**
 * Worker 앱의 바깥 의존성. 테스트가 갈아 끼울 수 있는 것만 둔다.
 *
 * 라우트가 모듈 전역 `requireAuth`를 직접 쓰면 테스트는 세션을 흉내 내려고
 * 핸들러를 통째로 복제해야 했다. 그러면 라우트가 바뀌어도 테스트가 모른다.
 * 팩토리에 주입해 실제 라우트를 그대로 검증한다.
 */
export interface AppDeps {
  readSession?: SessionReader;
}

export function resolveRequireAuth(deps: AppDeps) {
  return createRequireAuth(deps.readSession ?? readSessionFromBetterAuth);
}

export function resolveOptionalSession(deps: AppDeps) {
  return createOptionalSession(deps.readSession ?? readSessionFromBetterAuth);
}
