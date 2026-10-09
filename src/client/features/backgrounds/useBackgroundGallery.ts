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
import { useBackgroundSearch } from "../../lib/api/backgroundQueries";
import { BACKGROUND_COPY } from "#copy/backgrounds";

/**
 * 갤러리가 비었을 때의 이유. 배경이 하나도 없는지, 검색어에 맞는 배경이 없는지, 종류
 * 필터에 맞는 배경이 없는지, 검색 결과를 기다리는지, 검색할 수 없는지를 구분해 화면마다
 * 알맞은 안내를 고르게 한다.
 */
type BackgroundGalleryEmptyReason =
  "noBackgrounds" | "noMatch" | "noFilterMatch" | "searching" | "searchFailed";

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
  if (reason === "searching") return BACKGROUND_COPY.library.searching;
  if (reason === "searchFailed") return BACKGROUND_COPY.library.searchFailed;
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
 * 받아 로컬 카탈로그를 맞추고, 종류 필터와 검색 결과로 거른 배경을 돌려준다.
 *
 * 검색은 서버 벡터 검색이라 오프라인이면(요청이 멈춰 있으면) 실패로 안내한다. 검색어를
 * 지우면 서버 응답을 기다리지 않고 바로 전체 목록으로 돌아간다.
 */
export function useBackgroundGallery(query: string): BackgroundGallery {
  const catalog = useBackgroundCatalog();
  const [kind, setKind] = useState<BackgroundKindFilterValue>("all");

  useEffect(() => {
    void refreshBackgroundCatalog();
  }, []);

  const isSearch = query.trim() !== "";
  const search = useBackgroundSearch(query);
  const searchFailed = isSearch && (search.isError || search.isPaused);
  const resultIds = isSearch
    ? search.data?.results.map((result) => result.id)
    : undefined;

  const all = catalog.backgrounds;
  const visibleBackgrounds =
    isSearch && (!resultIds || searchFailed)
      ? []
      : filterBackgrounds(all, { kind, resultIds });
  const hasAnyBackground = all.length > 0;

  const emptyReason: BackgroundGalleryEmptyReason | null =
    visibleBackgrounds.length > 0
      ? null
      : !hasAnyBackground
        ? "noBackgrounds"
        : !isSearch
          ? "noFilterMatch"
          : searchFailed
            ? "searchFailed"
            : !resultIds
              ? "searching"
              : "noMatch";

  return {
    catalog,
    kind,
    setKind,
    visibleBackgrounds,
    hasAnyBackground,
    emptyReason,
  };
}
