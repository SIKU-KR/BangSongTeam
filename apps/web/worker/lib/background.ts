import type { Context } from "hono";

/**
 * 응답을 보낸 뒤 이어서 돌 작업을 맡긴다 (`ctx.waitUntil`).
 *
 * 가사 정규화처럼 사용자가 기다릴 이유가 없는 일에 쓴다. 별도 큐 인프라 없이
 * 응답 흐름을 막지 않는다 (TECH_SPEC §6.1). 오류는 응답에 영향을 주지 않도록
 * 로그로만 남긴다.
 *
 * 실행 컨텍스트가 없는 호출(`app.request`에 ctx를 주지 않은 테스트 등)에서는
 * Hono가 `executionCtx` 접근에서 던진다. 그때는 작업을 그냥 흘려보낸다.
 */
export function runInBackground(
  c: Context,
  label: string,
  task: () => Promise<unknown>,
): void {
  const promise = (async () => {
    try {
      const result = await task();
      console.info(`[background] ${label}`, result);
    } catch (err) {
      console.error(`[background] ${label} failed`, err);
    }
  })();

  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    void promise;
  }
}
