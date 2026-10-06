import { api } from "./client";
import { callApi } from "./request";

/**
 * 서버에 닿는지 가볍게 확인한다. 닿으면 true다.
 *
 * 브라우저 HTTP 캐시가 지난 응답을 돌려주면 끊긴 연결을 회복으로 오인하므로
 * `cache: "no-store"`로 보낸다. 오류는 던지지 않는다. 결과는 `callApi`가 연결
 * 상태(`connectivity`)에 이미 남긴다.
 */
export async function probeServerHealth(): Promise<boolean> {
  try {
    await callApi(() =>
      api.api.health.$get(undefined, { init: { cache: "no-store" } }),
    );
    return true;
  } catch {
    return false;
  }
}
