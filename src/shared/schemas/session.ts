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

/**
 * 탭이 자기 로그인 변화를 같은 브라우저의 다른 탭에 알리는 메시지(BroadcastChannel
 * `chiton:session`). 로그아웃이면 `null`, 로그인했거나 다른 계정으로 바뀌었으면 그 사용자 id다.
 *
 * 받는 탭은 이 사용자를 그대로 쓰지 않고 자기 사용자와 견주기만 한다. 다르면 새로고침하고,
 * 누가 로그인했는지는 다음 부팅이 정한다. 다른 탭(다른 배포판일 수도 있다)이 보낸 값이라 이
 * 스키마로 걸러 맞지 않으면 버린다.
 */
export const SessionBroadcastSchema = z.object({
  userId: z.string().min(1).nullable(),
});
export type SessionBroadcast = z.infer<typeof SessionBroadcastSchema>;
