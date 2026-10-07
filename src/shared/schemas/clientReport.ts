import { z } from "zod";

/** 한 번에 보내는 보고 수의 상한. 브라우저가 모아 두는 버퍼도 이만큼만 둔다 */
export const CLIENT_REPORT_MAX_COUNT = 20;

/** 보고 묶음 본문의 상한(바이트). 보고 20건이 넉넉히 들어가는 크기다 */
export const CLIENT_REPORT_MAX_BYTES = 8 * 1024;

/**
 * 브라우저가 겪은 요청 실패의 갈래.
 * - `timeout`: 데드라인 안에 응답이 오지 않았다
 * - `unreachable`: 네트워크 오류로 서버에 닿지 못했다
 * - `server_error`: 서버가 5xx로 답했다
 * - `stalled`: 미디어를 받다가 새 바이트가 오지 않아 끊었다. 본문을 다 받은 뒤 Cache Storage가
 *   멈춘 것은 서버와 상관없어 담지 않는다
 * - `interrupted`: 미디어 응답(200)은 왔는데 본문을 받다가 연결이 끊겼다. Worker 로그에는
 *   200으로 남으므로 `unreachable`과 나눠야 운영자가 서버 쪽 실패를 찾지 않는다
 */
export const ClientFailureKindSchema = z.enum([
  "timeout",
  "unreachable",
  "server_error",
  "stalled",
  "interrupted",
]);
export type ClientFailureKind = z.infer<typeof ClientFailureKindSchema>;

/**
 * 실패 보고 1건. Worker 로그의 `requestId`로 같은 요청을 찾을 수 있게 하는 것이 목적이다.
 *
 * 경로는 원문이 아니라 패턴(`/api/presentations/:id`)만 받는다. id·공유 토큰이 섞이면
 * 로그로 누가 무엇을 열었는지 드러난다. `.strict()`라 허용한 필드 밖의 값(가사, 오류
 * 메시지 등)이 실려 오면 통째로 거절한다.
 */
export const ClientReportSchema = z
  .object({
    requestId: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    kind: ClientFailureKindSchema,
    route: z
      .string()
      .max(80)
      .regex(/^\/api(\/[a-z0-9:*_-]+)*$/),
    online: z.boolean(),
    swControlled: z.boolean(),
  })
  .strict();
export type ClientReport = z.infer<typeof ClientReportSchema>;

export const ClientReportBatchSchema = z
  .object({
    appVersion: z.string().regex(/^[\w.-]{1,40}$/),
    reports: z.array(ClientReportSchema).min(1).max(CLIENT_REPORT_MAX_COUNT),
  })
  .strict();
export type ClientReportBatch = z.infer<typeof ClientReportBatchSchema>;
