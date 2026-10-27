import { z } from "zod";

/**
 * 탭의 계정이 끝난 이유. 로그아웃(`signedOut`), 세션 만료(`expired`), 다른 계정의 세션
 * (`switched`), 다른 탭의 로그인 변화(`otherTab`)다.
 *
 * 계정이 끝난 탭은 새로고침하기 직전에 이 값을 그 탭의 sessionStorage에 남기고, 다음 부팅이
 * 읽고 지운다. 저장소에서 읽는 값이라 깨졌거나 모르는 값은 이 스키마로 걸러 보통 부팅으로 본다.
 */
export const SessionEndReasonSchema = z.enum([
  "signedOut",
  "expired",
  "switched",
  "otherTab",
]);
export type SessionEndReason = z.infer<typeof SessionEndReasonSchema>;
