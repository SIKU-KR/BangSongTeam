import { Hono } from "hono";
import { AgreeConsentRequestSchema, API_ERRORS } from "#shared";
import { agreeToTerms, getTermsAgreedAt } from "#db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";
import { jsonBody } from "../lib/jsonBody";
import { SMALL_BODY_MAX_BYTES } from "../middleware/bodyLimit";

/**
 * 가입 동의(만 14세 이상·이용약관·개인정보 수집·이용).
 *
 * 소셜 로그인은 첫 로그인과 동시에 계정이 만들어져 가입 전에 동의를 받을 틈이 없다.
 * 그래서 계정마다 동의 시각을 두고, 비어 있으면 클라이언트가 동의 모달로 앱을 막는다.
 */
export function createConsentRoute(deps: AppDeps = {}) {
  const consentBody = jsonBody(AgreeConsentRequestSchema, SMALL_BODY_MAX_BYTES);

  return new Hono<AppEnv>()
    .use("*", resolveRequireAuth(deps))
    .get("/", async (c) => {
      const db = c.env.DB;
      const agreedAt = await getTermsAgreedAt(db, c.get("userId") as string);
      return c.json({ agreedAt: agreedAt?.toISOString() ?? null }, 200);
    })
    .post("/", consentBody, async (c) => {
      const db = c.env.DB;
      const agreedAt = await agreeToTerms(db, c.get("userId") as string);
      if (!agreedAt) return c.json({ error: API_ERRORS.userNotFound }, 404);
      return c.json({ agreedAt: agreedAt.toISOString() }, 200);
    });
}
