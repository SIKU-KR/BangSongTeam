import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { API_ERRORS } from "#shared";
import type { AppEnv } from "./types";
import type { AppDeps } from "./deps";
import { isTransientStorageError } from "./lib/storageErrors";
import { AUTH_BODY_MAX_BYTES, limitBody } from "./middleware/bodyLimit";
import { requestLog } from "./middleware/requestLog";
import { retryAfterOnUnavailable } from "./middleware/retryAfter";
import { sameOriginWrites } from "./middleware/sameOrigin";
import { createHealthRoute } from "./routes/health";
import { createAuthRoute } from "./routes/auth";
import { createClientReportsRoute } from "./routes/clientReports";
import { createConsentRoute } from "./routes/consent";
import { createPresentationsRoute } from "./routes/presentations";
import { createFoldersRoute } from "./routes/folders";
import { createDecksRoute } from "./routes/decks";
import { createCatalogRoute } from "./routes/catalog";
import { createReportsRoute } from "./routes/reports";
import { createShareRoute } from "./routes/share";
import { createBackgroundsRoute } from "./routes/backgrounds";
import { createMediaRoute } from "./routes/media";

/**
 * API 앱을 조립한다.
 *
 * 테스트는 `createApp({ readSession })`으로 세션만 바꿔 실제 라우트를 그대로
 * 검증한다. 프로덕션은 기본 의존성으로 만든 `app`을 쓴다.
 *
 * 모든 요청은 `requestLog`가 상관 ID와 함께 구조화 로그 한 줄로 남긴다. 처리되지 않은
 * 예외도 그 줄에 원인과 함께 실리므로 `onError`는 따로 로그를 남기지 않는다.
 *
 * `onError`·`notFound`와 라우트·검사 미들웨어가 만드는 오류 응답은 `{ error }`에 한국어 문장을
 * 담고, 클라이언트가 그 문장을 그대로 보여 준다. Better Auth가 답하는 `/api/auth/*`는
 * `{ code, message }`이고, 공유 라이브러리 검색어 검사 실패는 zValidator 기본 모양이다.
 * Hono가 4xx로 던진 예외(깨진 JSON 400 등)는 상태를 그대로 살려 서버 오류로 남기지 않는다.
 * 그 밖의 예외는 저장소 일시 장애면 503, 아니면 500이다. 503의 `Retry-After`는
 * `retryAfterOnUnavailable`이 단다.
 *
 * JSON 본문 크기는 라우트마다 세션 확인 뒤에 `jsonBody`가 제한한다. 로그인하지 않은 요청의 본문은
 * 읽지 않는다. 인증 경로만 Better Auth가 본문을 직접 읽으므로 여기서 제한한다.
 */
export function createApp(deps: AppDeps = {}) {
  return new Hono<AppEnv>()
    .onError((err, c) => {
      if (err instanceof HTTPException && err.status < 500) {
        const error =
          err.status === 413
            ? API_ERRORS.payloadTooLarge
            : API_ERRORS.idMismatch;
        return c.json({ error }, err.status);
      }
      if (isTransientStorageError(err)) {
        return c.json({ error: API_ERRORS.serverBusy }, 503);
      }
      return c.json({ error: API_ERRORS.requestFailed }, 500);
    })
    .notFound((c) => c.json({ error: API_ERRORS.notFound }, 404))
    .use("*", requestLog())
    .use("*", retryAfterOnUnavailable())
    .use("/api/*", sameOriginWrites())
    .use("/api/auth/*", limitBody(AUTH_BODY_MAX_BYTES))
    .route("/api/health", createHealthRoute())
    .route("/api/auth", createAuthRoute())
    .route("/api/client-reports", createClientReportsRoute())
    .route("/api/consent", createConsentRoute(deps))
    .route("/api/presentations", createPresentationsRoute(deps))
    .route("/api/folders", createFoldersRoute(deps))
    .route("/api/decks", createDecksRoute(deps))
    .route("/api/catalog", createCatalogRoute(deps))
    .route("/api/reports", createReportsRoute(deps))
    .route("/api/share", createShareRoute(deps))
    .route("/api/backgrounds", createBackgroundsRoute())
    .route("/api/media", createMediaRoute());
}

export type AppType = ReturnType<typeof createApp>;

const app = createApp();
export { app };
export default app;
