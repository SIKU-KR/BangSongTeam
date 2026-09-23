import {
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
} from "../sync/presentationSync";

/**
 * Hono RPC 응답을 구조적으로만 받는다 (`ClientResponse`는 workers-types의
 * `Response`와 다른 타입이다).
 */
interface RpcResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}

/**
 * 공유 라이브러리 요청 1건을 보낸다.
 *
 * 동기화 경로(`presentationSync.send`)와 같은 오류 구분을 쓰되, 동기화 상태
 * 표시(`syncStatus`)는 건드리지 않는다. 검색 한 번 실패했다고 '저장 안 됨'
 * 배지가 뜨면 안 된다.
 *
 * - 네트워크에 닿지 못함 → `OfflineError`
 * - 401 → `SessionExpiredError`
 * - 그 외 4xx·5xx → `ServerRejectedError(status, 서버가 준 한국어 문장)`
 */
export async function callApi<T>(
  request: () => Promise<RpcResponse>,
): Promise<T> {
  let response: RpcResponse;
  try {
    response = await request();
  } catch (err) {
    throw new OfflineError(err);
  }

  if (response.status === 401) throw new SessionExpiredError();
  if (!response.ok) {
    let message: string | undefined;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // 본문이 JSON이 아니면 상태 코드만으로 알린다
    }
    throw new ServerRejectedError(response.status, message);
  }
  return (await response.json()) as T;
}

/** 사용자에게 보여 줄 오류 문장 */
export function describeApiError(err: unknown): string {
  if (err instanceof OfflineError)
    return "오프라인이라 서버에 연결할 수 없습니다";
  if (err instanceof SessionExpiredError)
    return "로그인이 만료되었습니다. 다시 로그인해 주세요";
  if (err instanceof ServerRejectedError) return err.message;
  return "요청을 처리하지 못했습니다";
}
