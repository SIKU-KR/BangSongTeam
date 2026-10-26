import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { getTermsAgreedAt } from "#db";
import { API_ERRORS } from "#shared";
import type { AppEnv } from "../types";

/**
 * 세션 사용자가 가입 동의(만 14세 이상·이용약관·개인정보 수집·이용)를 마쳤는지.
 *
 * 동의 모달(`ConsentGate`)은 클라이언트에만 있고, 동의 상태를 확인하지 못하면(오프라인 등)
 * 막지 않는다. 그래서 공개 게시·링크 공유 켜기·가져오기·신고·공유 링크 참여처럼 다른 사람에게
 * 보이거나 남의 곡에 닿는 일은 서버가 다시 확인한다. `requireAuth` 뒤에서만 부른다.
 */
export async function hasAgreedToTerms(c: Context<AppEnv>): Promise<boolean> {
  return (await getTermsAgreedAt(c.env.DB, c.get("userId") as string)) !== null;
}

/**
 * 가입 동의 전이면 403으로 끊는다. 동기화 저장에는 붙이지 않는다. 동의 모달이 통과시킨 사이에
 * 쌓인 저장이 실패하면 안 된다.
 */
export const requireConsent: MiddlewareHandler<AppEnv> =
  createMiddleware<AppEnv>(async (c, next) => {
    if (!(await hasAgreedToTerms(c))) {
      return c.json({ error: API_ERRORS.consentRequired }, 403);
    }
    await next();
  });
