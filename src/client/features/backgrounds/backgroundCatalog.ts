import { useMemo, useSyncExternalStore } from "react";
import type { BackgroundMedia } from "#shared";
import { loadAllBackgrounds, replaceAllBackgrounds } from "../../lib/storage";

/**
 * - `local`: IndexedDB 사본만 있다 (부팅 직후, 송출 화면)
 * - `synced`: 서버 목록과 맞췄다
 * - `offline` / `error`: 서버에 닿지 못했다. 로컬 사본으로 계속 쓴다
 */
export type BackgroundCatalogStatus = "local" | "synced" | "offline" | "error";

export interface BackgroundCatalogSnapshot {
  backgrounds: BackgroundMedia[];
  status: BackgroundCatalogStatus;
}

/** 배경 레이어에 넘길 URL. 이미지 배경은 영상 대신 정지 이미지로 그린다 */
export interface BackgroundLayers {
  videoUrl?: string;
  imageUrl?: string;
  posterUrl?: string;
}

const EMPTY: BackgroundCatalogSnapshot = {
  backgrounds: [],
  status: "local",
};

/** 서버 목록(`ORDER BY title`, SQLite 바이너리 비교)과 같은 순서 */
function byTitle(backgrounds: BackgroundMedia[]): BackgroundMedia[] {
  return [...backgrounds].sort((a, b) =>
    a.title < b.title ? -1 : a.title > b.title ? 1 : 0,
  );
}

let snapshot: BackgroundCatalogSnapshot = EMPTY;
let byId = new Map<string, BackgroundMedia>();
const listeners = new Set<() => void>();

function setSnapshot(next: BackgroundCatalogSnapshot): void {
  snapshot = next;
  byId = new Map(next.backgrounds.map((bg) => [bg.id, bg]));
  for (const listener of listeners) listener();
}

async function persist(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    void error;
  }
}

/**
 * IndexedDB 사본으로 카탈로그를 채운다.
 *
 * 송출 화면도 이 경로만 탄다 (송출 중 데이터 요청 0건). 저장소를 쓸 수 없으면
 * 빈 카탈로그로 두고, 곡은 배경 없이 그려진다.
 */
export async function hydrateBackgroundCatalog(): Promise<void> {
  let backgrounds: BackgroundMedia[] = [];
  try {
    backgrounds = await loadAllBackgrounds();
  } catch (error) {
    void error;
  }
  setSnapshot({
    backgrounds: byTitle(backgrounds),
    status: "local",
  });
}

/**
 * 서버가 준 목록으로 통째로 바꾼다 (지워진 배경이 남지 않게).
 *
 * `unreadableIds`는 서버에 있지만 형식이 어긋나 이 기기가 읽지 못한 배경이다. 가진 사본이
 * 있으면 남긴다. 배포가 엇갈리거나 운영자가 여러 배경을 한꺼번에 잘못 고쳤을 때 그 배경이
 * 모든 기기의 카탈로그와 송출용 사본에서 사라지면, 그 배경을 쓰는 곡이 예배 중에 배경 없이
 * 송출된다.
 */
export async function applyServerBackgroundCatalog(
  backgrounds: BackgroundMedia[],
  unreadableIds: readonly string[] = [],
): Promise<void> {
  const read = new Set(backgrounds.map((background) => background.id));
  const kept = unreadableIds.flatMap((id) => {
    const local = byId.get(id);
    return local && !read.has(id) ? [local] : [];
  });
  const next =
    kept.length > 0 ? byTitle([...backgrounds, ...kept]) : backgrounds;
  setSnapshot({ backgrounds: next, status: "synced" });
  await persist(() => replaceAllBackgrounds(next));
}

export function markBackgroundCatalogStatus(
  status: BackgroundCatalogStatus,
): void {
  if (snapshot.status === status) return;
  setSnapshot({ ...snapshot, status });
}

function getBackgroundCatalog(): BackgroundCatalogSnapshot {
  return snapshot;
}

export function getBackgroundById(
  id: string | null | undefined,
): BackgroundMedia | undefined {
  return id ? byId.get(id) : undefined;
}

export function getBackgrounds(): BackgroundMedia[] {
  return snapshot.backgrounds;
}

export function getBackgroundCatalogStatus(): BackgroundCatalogStatus {
  return snapshot.status;
}

export function resolveBackgroundLayers(
  background: BackgroundMedia | undefined,
): BackgroundLayers {
  if (!background) return {};
  if (background.kind === "image") {
    return { imageUrl: background.mediaUrl, posterUrl: background.posterUrl };
  }
  return { videoUrl: background.mediaUrl, posterUrl: background.posterUrl };
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function useBackgroundCatalog(): BackgroundCatalogSnapshot {
  return useSyncExternalStore(
    subscribe,
    getBackgroundCatalog,
    getBackgroundCatalog,
  );
}

export function useBackground(
  id: string | null | undefined,
): BackgroundMedia | undefined {
  const find = (): BackgroundMedia | undefined => getBackgroundById(id);
  return useSyncExternalStore(subscribe, find, find);
}

/**
 * 카탈로그 스냅샷으로 만든 id → 배경 찾기 함수.
 *
 * 목록이 바뀔 때만 새 함수가 되어, 이 함수에 기대는 `useMemo`·이펙트가 렌더마다
 * 다시 돌지 않는다.
 */
export function useBackgroundLookup(): (
  id: string,
) => BackgroundMedia | undefined {
  const catalog = useBackgroundCatalog();
  return useMemo(() => {
    const byId = new Map(catalog.backgrounds.map((bg) => [bg.id, bg]));
    return (id: string) => byId.get(id);
  }, [catalog.backgrounds]);
}

/** 곡 배경을 배경 레이어에 넘길 URL로 바꾼다. 배경이 없거나 지워졌으면 빈 레이어 */
export function useBackgroundLayers(
  id: string | null | undefined,
): BackgroundLayers {
  return resolveBackgroundLayers(useBackground(id));
}

/** 테스트 격리용. 저장소는 건드리지 않는다 */
export function setBackgroundCatalogForTests(
  backgrounds: BackgroundMedia[],
  status: BackgroundCatalogStatus = "synced",
): void {
  setSnapshot({ backgrounds, status });
}

export function resetBackgroundCatalogForTests(): void {
  setSnapshot(EMPTY);
}
