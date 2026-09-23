import React from "react";
import type { CatalogStatus } from "@repo/shared";

/**
 * 가사 라이브러리 곡 상태 표시 (PRD 4.8 표시).
 *
 * - 등록 1명: '1명 등록' — 원본 그대로
 * - 정규화됨: '정규화됨 · N명 등록' — N은 루트 버전 수
 * - 운영자 검수: '검수됨 · N명 등록' — 잠긴 대표 가사
 */
export function catalogStatusLabel(
  status: CatalogStatus,
  versionCount: number,
): string {
  if (status === "locked") return `검수됨 · ${versionCount}명 등록`;
  if (status === "normalized" && versionCount >= 2)
    return `정규화됨 · ${versionCount}명 등록`;
  return `${versionCount}명 등록`;
}

export function CatalogStatusBadge({
  status,
  versionCount,
}: {
  status: CatalogStatus;
  versionCount: number;
}): React.JSX.Element {
  const tone =
    status === "locked"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
      : status === "normalized"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span
      data-testid="catalog-status-badge"
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tone}`}
    >
      {catalogStatusLabel(status, versionCount)}
    </span>
  );
}
