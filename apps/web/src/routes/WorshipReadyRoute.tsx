import React, { useCallback, useLayoutEffect } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  openPresentation,
  usePresentationById,
  launchPresentation,
} from "../features/presentation";
import { useWorshipPrep } from "../features/offline";
import type { PresentationMediaAsset } from "@repo/shared";
import type { MediaCacheItem } from "../lib/offline";

/**
 * 예배 준비 화면 (`/present/:presentationId/ready`, PRD 5 화면 목록).
 *
 * 송출 진입의 **권장 관문**이다(2026-09-22 결정). 배경 영상을 미리 받아 두면
 * 예배당 네트워크가 끊겨도 완주할 수 있지만, 캐시가 끝나지 않았다고 송출 자체를
 * 막지는 않는다 — 영상이 없다고 예배를 못 하게 만드는 것이 더 큰 사고다.
 */

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return "0.1 MB 미만";
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

type AssetStatus = "none" | "pending" | "downloading" | "done" | "failed";

function statusOf(
  asset: PresentationMediaAsset,
  items: readonly MediaCacheItem[],
): AssetStatus {
  if (!asset.mediaUrl) return "none";
  const item = items.find((entry) => entry.url === asset.mediaUrl);
  return item?.status ?? "pending";
}

const STATUS_LABEL: Record<AssetStatus, string> = {
  none: "배경 없음",
  pending: "대기 중",
  downloading: "받는 중…",
  done: "준비 완료",
  failed: "실패",
};

const STATUS_CLASS: Record<AssetStatus, string> = {
  none: "text-zinc-400 dark:text-zinc-500",
  pending: "text-zinc-500 dark:text-zinc-400",
  downloading: "text-sky-600 dark:text-sky-400",
  done: "text-emerald-600 dark:text-emerald-400",
  failed: "text-red-600 dark:text-red-400",
};

export function WorshipReadyRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const { presentationId } = useParams<{ presentationId: string }>();
  const presentation = usePresentationById(presentationId);

  useLayoutEffect(() => {
    if (presentationId) openPresentation(presentationId);
  }, [presentationId]);

  const prep = useWorshipPrep(presentation ?? null);

  // 전체화면은 클릭 제스처 안에서 동기적으로 요청해야 Chrome이 허용한다.
  const handleSoloPresent = useCallback(() => {
    if (!presentationId) return;
    launchPresentation(navigate, presentationId);
  }, [navigate, presentationId]);

  const handlePresenterView = useCallback(() => {
    if (!presentationId) return;
    navigate(`/present/${presentationId}/control`);
  }, [navigate, presentationId]);

  if (!presentation) return <Navigate to="/presentations" replace />;

  const percent = Math.round(prep.progress * 100);
  const failedCount = prep.items.filter(
    (item) => item.status === "failed",
  ).length;

  return (
    <div
      data-testid="worship-ready-route"
      className="min-h-screen w-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-y-auto"
    >
      <div className="max-w-3xl mx-auto px-6 py-10">
        <button
          type="button"
          onClick={() => navigate("/presentations")}
          className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer"
        >
          ← 대시보드로
        </button>

        <header className="mt-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{presentation.title}</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {presentation.serviceDate} · {presentation.items.length}곡 · 예배
              준비
            </p>
          </div>

          {prep.isReady ? (
            <span
              data-testid="offline-ready-badge"
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-600 text-white"
            >
              오프라인 송출 가능
            </span>
          ) : (
            <span
              data-testid="offline-pending-badge"
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
            >
              {prep.phase === "preparing" ? "배경 내려받는 중…" : "준비 필요"}
            </span>
          )}
        </header>

        {/* 진행률 및 용량 */}
        <section className="mt-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">배경 영상 캐시</span>
            <span
              data-testid="cache-total-size"
              className="text-zinc-500 dark:text-zinc-400"
            >
              {formatBytes(prep.totalBytes)}
              {prep.estimate
                ? ` · 저장소 사용 ${formatBytes(prep.estimate.usageBytes)}`
                : ""}
            </span>
          </div>

          <div className="mt-3 h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div
              data-testid="cache-progress-bar"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>

          {prep.phase === "unsupported" && (
            <p
              data-testid="cache-unsupported-warning"
              className="mt-3 text-xs text-amber-600 dark:text-amber-400"
            >
              이 브라우저는 오프라인 캐시(Cache Storage)를 지원하지 않습니다.
              송출 중 네트워크가 끊기면 배경이 나오지 않습니다.
            </p>
          )}

          {failedCount > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p
                data-testid="cache-failed-warning"
                className="text-xs text-red-600 dark:text-red-400"
              >
                {failedCount}개 자산을 받지 못했습니다. 네트워크를 확인한 뒤 다시
                시도해 주세요.
              </p>
              <button
                type="button"
                data-testid="cache-retry-btn"
                onClick={prep.start}
                className="shrink-0 text-xs px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                다시 시도
              </button>
            </div>
          )}

          {prep.storage === "denied" && (
            <p
              data-testid="storage-persist-warning"
              className="mt-3 text-xs text-amber-600 dark:text-amber-400"
            >
              브라우저가 영구 저장소를 허용하지 않았습니다. 저장 공간이 부족해지면
              받아 둔 배경이 지워질 수 있으니, 예배 직전에 이 화면을 한 번 더 열어
              주세요.
            </p>
          )}
        </section>

        {/* 곡별 캐시 상태 */}
        <section className="mt-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <ul data-testid="prep-song-list" className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {prep.assets.map((asset) => {
              const status = statusOf(asset, prep.items);
              return (
                <li
                  key={`${asset.songIndex}-${asset.backgroundId ?? "none"}`}
                  data-testid="prep-song-row"
                  className="flex items-center gap-3 px-5 py-3 text-sm"
                >
                  <span className="w-6 shrink-0 text-zinc-400 dark:text-zinc-500 tabular-nums">
                    {asset.songIndex + 1}.
                  </span>
                  <span className="flex-1 truncate font-medium">
                    {asset.songTitle}
                  </span>
                  <span className="flex-1 truncate text-zinc-500 dark:text-zinc-400">
                    {asset.backgroundTitle ?? "—"}
                  </span>
                  <span
                    className={`shrink-0 text-xs font-medium ${STATUS_CLASS[status]}`}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* 송출 시작 */}
        <section className="mt-6 flex flex-col gap-3">
          {!prep.isReady && prep.phase !== "checking" && (
            <p
              data-testid="present-anyway-notice"
              className="text-xs text-zinc-500 dark:text-zinc-400"
            >
              아직 준비가 끝나지 않았습니다. 지금 송출하면 배경 영상을 네트워크에서
              가져오므로, 연결이 끊기면 배경이 검게 나올 수 있습니다.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="start-presenter-btn"
              onClick={handlePresenterView}
              className="px-4 py-2.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
            >
              발표자 보기로 송출
            </button>
            <button
              type="button"
              data-testid="start-solo-btn"
              onClick={handleSoloPresent}
              className="px-4 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              단독 전체화면 송출
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
