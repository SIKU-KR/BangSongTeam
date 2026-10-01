import { useEffect, useState } from "react";
import type { BackgroundMedia } from "#shared";
import {
  useBackgroundCatalog,
  type BackgroundCatalogSnapshot,
} from "./backgroundCatalog";
import {
  filterBackgrounds,
  type BackgroundKindFilterValue,
} from "./backgroundSearch";
import { refreshBackgroundCatalog } from "../../lib/sync/backgroundSync";
import { BACKGROUND_COPY } from "#copy/backgrounds";

/**
 * 갤러리가 비었을 때의 이유. 배경이 하나도 없는지, 검색어에 맞는 배경이 없는지, 종류
 * 필터에 맞는 배경이 없는지를 구분해 화면마다 알맞은 안내를 고르게 한다.
 */
type BackgroundGalleryEmptyReason =
  "noBackgrounds" | "noMatch" | "noFilterMatch";

/**
 * 빈 갤러리 안내 문구. 배경 갤러리와 배경 선택 창이 같은 이유에 같은 문구를 보이도록
 * 한 곳에 둔다.
 */
export function describeBackgroundGalleryEmpty(
  reason: BackgroundGalleryEmptyReason,
  query: string,
): string {
  if (reason === "noBackgrounds") return BACKGROUND_COPY.noBackgrounds;
  if (reason === "noMatch") return BACKGROUND_COPY.library.noMatch(query);
  return BACKGROUND_COPY.library.noFilterMatch;
}

interface BackgroundGallery {
  catalog: BackgroundCatalogSnapshot;
  kind: BackgroundKindFilterValue;
  setKind: (next: BackgroundKindFilterValue) => void;
  visibleBackgrounds: BackgroundMedia[];
  hasAnyBackground: boolean;
  emptyReason: BackgroundGalleryEmptyReason | null;
}

/**
 * 배경 갤러리와 배경 선택 창이 함께 쓰는 목록 상태. 열릴 때 서버 목록을 한 번 새로
 * 받아 로컬 카탈로그를 맞추고, 종류 필터와 검색어로 거른 배경을 돌려준다.
 */
export function useBackgroundGallery(query: string): BackgroundGallery {
  const catalog = useBackgroundCatalog();
  const [kind, setKind] = useState<BackgroundKindFilterValue>("all");

  useEffect(() => {
    void refreshBackgroundCatalog();
  }, []);

  const all = catalog.backgrounds;
  const visibleBackgrounds = filterBackgrounds(all, { kind, query });
  const hasAnyBackground = all.length > 0;

  const emptyReason: BackgroundGalleryEmptyReason | null =
    visibleBackgrounds.length > 0
      ? null
      : !hasAnyBackground
        ? "noBackgrounds"
        : query.trim()
          ? "noMatch"
          : "noFilterMatch";

  return {
    catalog,
    kind,
    setKind,
    visibleBackgrounds,
    hasAnyBackground,
    emptyReason,
  };
}
