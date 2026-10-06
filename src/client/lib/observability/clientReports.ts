import {
  CLIENT_REPORT_MAX_COUNT,
  CLIENT_REPORTS_PATH,
  ClientReportSchema,
  type ClientFailureKind,
  type ClientReport,
  type ClientReportBatch,
} from "#shared";
import { isProjectionPath } from "../../features/presentation/fullscreen";
import {
  OfflineError,
  ServerRejectedError,
  TimeoutError,
} from "../api/request";
import { isServiceWorkerControlled } from "../browser/capabilities";

/** 빌드한 커밋의 짧은 SHA. CI 밖(개발 서버·테스트)에서는 `dev`다 */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

const PENDING_STORAGE_KEY = "client-reports-pending";

let buffer: ClientReport[] = [];

function reportKey(report: ClientReport): string {
  return `${report.kind}|${report.route}|${report.requestId ?? ""}`;
}

function mergeReports(...lists: ClientReport[][]): ClientReport[] {
  const merged = new Map<string, ClientReport>();
  for (const report of lists.flat()) merged.set(reportKey(report), report);
  return [...merged.values()].slice(-CLIENT_REPORT_MAX_COUNT);
}

function loadPending(): ClientReport[] {
  try {
    const raw = localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate) => {
      const result = ClientReportSchema.safeParse(candidate);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

function savePending(reports: ClientReport[]): void {
  try {
    if (reports.length === 0) localStorage.removeItem(PENDING_STORAGE_KEY);
    else localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(reports));
  } catch {
    return;
  }
}

/**
 * 요청 실패 1건을 보낼 묶음에 담는다. 최근 `CLIENT_REPORT_MAX_COUNT`건만 남긴다.
 *
 * 담는 값은 상관 ID·실패 갈래·경로 패턴·온라인 여부·SW 제어 여부뿐이다. 오류 메시지나
 * 요청 본문(가사)은 받지도 않는다. 앱 버전은 보낼 때 묶음에 한 번 붙인다.
 */
export function recordClientFailure(input: {
  kind: ClientFailureKind;
  route: string;
  requestId?: string;
}): void {
  const report: ClientReport = {
    ...(input.requestId ? { requestId: input.requestId } : {}),
    kind: input.kind,
    route: input.route,
    online: typeof navigator === "undefined" || navigator.onLine !== false,
    swControlled: isServiceWorkerControlled(),
  };
  if (!ClientReportSchema.safeParse(report).success) return;
  buffer = mergeReports(buffer, [report]);
}

/**
 * `callApi`가 던진 오류를 보고 갈래로 옮긴다. 타임아웃·닿지 못함·5xx만 담는다.
 *
 * 4xx·세션 만료·호출자 취소는 서버나 네트워크가 실패한 것이 아니라 담지 않는다.
 * 연결 회복 확인(`probeServerHealth`)은 이 경로를 지나지 않는다. 끊긴 동안 몇 초마다
 * 실패하는 확인 요청이 묶음을 채우면 정작 동기화 실패가 밀려난다.
 */
export function reportApiFailure(err: unknown): void {
  if (err instanceof TimeoutError || err instanceof OfflineError) {
    if (!err.route) return;
    recordClientFailure({
      kind: err instanceof TimeoutError ? "timeout" : "unreachable",
      route: err.route,
      requestId: err.requestId,
    });
    return;
  }
  if (err instanceof ServerRejectedError && err.status >= 500 && err.route) {
    recordClientFailure({
      kind: "server_error",
      route: err.route,
      requestId: err.requestId,
    });
  }
}

function canSendNow(): boolean {
  return (
    typeof window !== "undefined" &&
    !isProjectionPath(window.location.pathname) &&
    navigator.onLine !== false &&
    typeof navigator.sendBeacon === "function"
  );
}

/**
 * 모아 둔 실패 보고를 한 번에 보낸다. `pagehide`·탭 숨김과 송출이 아닌 화면에 들어올 때 부른다.
 *
 * `navigator.sendBeacon`을 쓰는 까닭은 페이지가 닫히는 중에도 브라우저가 끝까지 보내 주기
 * 때문이다. 그래서 Hono RPC 클라이언트(`fetch`)를 거치지 않는다. 응답은 읽지 않는다.
 *
 * 송출 화면에서는 보내지 않는다(송출 중 API 요청 0건). 그때와 오프라인일 때, 브라우저가
 * 보내기를 거절했을 때는 `localStorage`에 남겨 두고, 다음 화면이나 다음 실행에서
 * 이어 보낸다.
 */
export function flushClientReports(): void {
  const reports = mergeReports(loadPending(), buffer);
  buffer = [];
  if (reports.length === 0) return;
  if (!canSendNow()) {
    savePending(reports);
    return;
  }
  const batch: ClientReportBatch = { appVersion: APP_VERSION, reports };
  let sent = false;
  try {
    sent = navigator.sendBeacon(
      CLIENT_REPORTS_PATH,
      new Blob([JSON.stringify(batch)], { type: "application/json" }),
    );
  } catch {
    sent = false;
  }
  savePending(sent ? [] : reports);
}

export function __resetClientReportsForTests(): void {
  buffer = [];
  savePending([]);
}
