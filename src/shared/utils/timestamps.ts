/**
 * 서버가 받아 주는 기기 시계의 앞섬(5분). 기기 시계는 몇 분씩 어긋나기도 해서 그만큼은 받아 주고,
 * 그보다 늦은 시각은 서버 시계 + 5분으로 줄인다(`clampToClock`).
 */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * 시각이 담길 수 있는 마지막 값(ms). Firestore Timestamp와 스키마의 ISO 시각(네 자리 연도)이 여기서
 * 끝난다. 더 늦은 값은 스키마가 거절하고, 서버의 `toDate`는 1970년으로 바꿔 쓴다.
 */
export const MAX_FIRESTORE_TIME = Date.parse("9999-12-31T23:59:59.999Z");

/**
 * 기기가 보낸 시각을 서버 시계(`nowMs`) + 5분까지로 줄인다.
 *
 * 빠른 시계나 꾸민 요청이 미래 시각을 남기면 시각으로 판을 고르는 병합과 서버의 옛 쓰기 거르기에서
 * 그 판이 줄곧 이긴다.
 */
export function clampToClock(iso: string, nowMs: number): string {
  const limit = nowMs + MAX_CLOCK_SKEW_MS;
  return Date.parse(iso) > limit ? new Date(limit).toISOString() : iso;
}

/**
 * 앞 판(`previousIso`)을 바꾸는 판의 시각. 후보가 앞 판보다 늦으면 후보, 아니면 앞 판 + 1ms다.
 *
 * 서버는 프레젠테이션 판을 이 값으로 찍어, 받은 저장마다 판이 늘 커진다. 되돌리기처럼 옛 시각을 담은
 * 저장도 앞 판보다 뒤가 되어 다른 기기가 그 판을 받고, 서로 다른 내용이 한 판을 나눠 갖지 않는다.
 */
export function laterThan(
  previousIso: string | null | undefined,
  candidateIso: string,
): string {
  const previous = previousIso ? Date.parse(previousIso) : Number.NaN;
  if (Number.isNaN(previous) || Date.parse(candidateIso) > previous) {
    return candidateIso;
  }
  return new Date(previous + 1).toISOString();
}

/**
 * 기기가 본 판(`previousIso`)을 고친 판의 시각: 지금이되 본 판보다 적어도 1ms 뒤다. 담길 수 있는
 * 마지막 시각(`MAX_FIRESTORE_TIME`)은 넘지 않아, 본 판이 그 시각이면 본 판과 같다.
 *
 * 고친 판은 그것이 바꾸는 판보다 늦어야 한다. 서버는 저장본보다 이른 폴더·보관함 곡 쓰기를 늦게 온 옛
 * 수정으로 보고 버리고(`isOutdatedWrite`), 시각으로 판을 고르는 병합도 이른 쪽을 옛 판으로 본다. 본
 * 판은 다른 기기나 서버(가져오기)가 찍은 시각이라 이 기기 시계보다 몇십 분 앞설 수 있다. 기기는 제
 * 시계가 뒤처진 것과 본 판이 미래에 박힌 것을 가리지 못하므로 본 판을 기기 시계로 줄이지 않는다.
 * 미래에 박힌 판 뒤로 찍은 시각은 서버가 서버 시계 + 5분까지로 줄여 받는다(`clampToClock`).
 */
export function editTimestamp(
  previousIso: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  const seen = Date.parse(previousIso ?? "");
  return laterThan(
    Number.isNaN(seen)
      ? null
      : new Date(Math.min(seen, MAX_FIRESTORE_TIME - 1)).toISOString(),
    new Date(nowMs).toISOString(),
  );
}

/**
 * 기기 시계 + 10분(서버가 받아 주는 앞섬의 두 배)보다 늦은 시각인지. 시각을 줄이기 전에 빠른 시계가
 * 남긴 값이라, 이런 로컬 판은 병합에서 서버 판을 이기지 못하게 한다. 두 배로 잡아서, 서버가 줄인 값
 * 바로 뒤로 찍은 새 수정은 기기 시계가 서버보다 5분 넘게 뒤처지지 않으면 걸리지 않는다. 그보다
 * 뒤처진 기기에서는 본 판 뒤로 찍은 제 수정(`editTimestamp`)도 걸릴 수 있다.
 */
export function isFarFuture(iso: string, nowMs: number = Date.now()): boolean {
  return Date.parse(iso) > nowMs + 2 * MAX_CLOCK_SKEW_MS;
}

/**
 * 저장본(`storedIso`)이 들어온 쓰기(`clampToClock`을 거친 `incomingIso`)보다 늦어서, 쓰지 않고
 * 저장본을 돌려줄지. 폴더·보관함 곡은 수정 시각이 늦은 쪽이 이긴다.
 *
 * - 오프라인 대기열이 늦게 올린 옛 수정이 다른 기기의 새 수정을 덮지 않는다.
 * - 시각이 같으면 쓴다. 같은 본문을 다시 보낸 재시도와 서버가 고친 값을 받아 다시 올린 저장이다.
 * - 서버 시계 + 5분을 넘는 저장본은 막지 않는다. 시각을 줄이기 전에 빠른 시계가 남긴 값이라, 막으면
 *   주인이 그 곡·폴더를 그 시각까지 고치지 못한다.
 */
export function isOutdatedWrite(
  storedIso: string,
  incomingIso: string,
  nowMs: number,
): boolean {
  const stored = Date.parse(storedIso);
  return (
    stored <= nowMs + MAX_CLOCK_SKEW_MS && stored > Date.parse(incomingIso)
  );
}
