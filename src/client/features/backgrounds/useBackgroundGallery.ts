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
import {
  refreshBackgroundCatalog,
  retryBackgroundCatalogIfNeeded,
} from "../../lib/sync/backgroundSync";
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
  loadFailed: boolean;
  retryLoad: () => void;
}

const retryLoad = (): void => {
  retryBackgroundCatalogIfNeeded("manual");
};

/**
 * 배경 갤러리와 배경 선택 창이 함께 쓰는 목록 상태. 열릴 때 서버 목록을 한 번 새로
 * 받아 로컬 카탈로그를 맞추고, 종류 필터와 검색어로 거른 배경을 돌려준다.
 *
 * 서버가 목록을 주지 못했으면(`loadFailed`) 가진 목록이 비어 있어도 `noBackgrounds`로 보지
 * 않는다. 배경이 없는 것이 아니라 받지 못한 것이라, 화면은 그 사실과 다시 받기(`retryLoad`)를
 * 보여 준다. 다시 받기는 '다시 시도'(`manual`)라서 여러 번 받지 못해 스스로 다시 받기를 멈춘
 * 목록도 백오프를 비우고 다시 받는다. 그래야 그 뒤에 또 실패해도 서버가 돌아오면 스스로 받는다.
 */
export function useBackgroundGallery(query: string): BackgroundGallery {
  const catalog = useBackgroundCatalog();
  const [kind, setKind] = useState<BackgroundKindFilterValue>("all");

  useEffect(() => {
    void refreshBackgroundCatalog();
  }, []);

  const isSearch = query.trim() !== "";
  const all = catalog.backgrounds;
  const visibleBackgrounds = filterBackgrounds(all, { kind, query });
  const hasAnyBackground = all.length > 0;
  const loadFailed = catalog.status === "error";

  const emptyReason: BackgroundGalleryEmptyReason | null =
    visibleBackgrounds.length > 0 || (!hasAnyBackground && loadFailed)
      ? null
      : !hasAnyBackground
        ? "noBackgrounds"
        : isSearch &&
            filterBackgrounds(all, { kind: "all", query }).length === 0
          ? "noMatch"
          : "noFilterMatch";

  return {
    catalog,
    kind,
    setKind,
    visibleBackgrounds,
    hasAnyBackground,
    emptyReason,
    loadFailed,
    retryLoad,
  };
}
