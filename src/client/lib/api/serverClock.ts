const DATE_HEADER_RESOLUTION_MS = 1000;
const CACHEABLE = /\bmax-age=[1-9]|\bimmutable\b/i;

let serverAheadMs = 0;

/**
 * API 응답의 `Date` 헤더로 서버 시계가 이 기기 시계보다 얼마나 앞서는지 잰다. `callApi`가 응답마다
 * 부르고, 나중 응답이 잰 값을 따른다.
 *
 * 헤더는 초 단위로 버린 값이라 서버 시계는 그 초의 끝까지 갔다고 보고, 그만큼(1초)보다 더 앞설 때만
 * 차이로 남긴다. 그 밖에는 기기 시계가 서버와 같거나 빠른 것이라 차이를 0으로 둔다. 캐시에 둘 수 있는
 * 응답(`max-age`·`immutable`)은 브라우저 캐시에서 온 지난 시각일 수 있어 재지 않는다.
 */
export function noteServerClock(headers: Headers | undefined): void {
  const date = headers?.get("date");
  if (!date || CACHEABLE.test(headers?.get("cache-control") ?? "")) return;
  const serverMs = Date.parse(date);
  if (Number.isNaN(serverMs)) return;
  const ahead = serverMs + DATE_HEADER_RESOLUTION_MS - Date.now();
  serverAheadMs = ahead > DATE_HEADER_RESOLUTION_MS ? ahead : 0;
}

/**
 * 폴더·보관함 곡의 수정 시각을 찍고 한참 앞선 시각을 가를 때 쓰는 지금(ms). 기기 시계가 서버보다
 * 늦으면 응답으로 잰 서버 시계이고(`noteServerClock`), 아니면 기기 시계다.
 *
 * 서버는 폴더·곡 저장을 수정 시각으로 가르고(저장된 판보다 이른 쓰기는 늦게 온 옛 수정으로 버린다)
 * 기기 시각을 서버 시계 + 5분까지만 받는다. 시계가 늦은 기기가 기기 시계로 찍으면, 본 판보다는
 * 뒤라도(`editTimestamp`) 그사이 다른 기기가 고친 판보다 이른 시각이 나와 서버가 그 수정을 버리고
 * 이름·위치·휴지통이 되돌아간다. 서버 판 바로 뒤로 찍은 판도 기기 시계로는 한참 앞선 값(`isFarFuture`)이라
 * 병합과 push 응답에서 서버 판에 진다. 기기 시계가 빠르면 그대로 쓴다. 서버가 줄인 시각을 돌려주고 이
 * 기기는 그 시각을 따른다.
 */
export function serverAlignedNow(): number {
  return Date.now() + serverAheadMs;
}

export function __resetServerClockForTests(): void {
  serverAheadMs = 0;
}
