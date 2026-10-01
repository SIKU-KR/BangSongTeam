import React from "react";
import { ImageIcon, WifiOffIcon } from "lucide-react";
import { Alert, AlertDescription } from "#components/ui/alert";
import { Card } from "#components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#components/ui/empty";
import type { BackgroundMedia } from "#shared";
import { BackgroundKindFilter, BackgroundPreview } from "../backgrounds";
import {
  describeBackgroundGalleryEmpty,
  useBackgroundGallery,
} from "../backgrounds/useBackgroundGallery";
import { useIsOnline } from "../../hooks/useIsOnline";
import { BACKGROUND_COPY } from "#copy/backgrounds";

interface BackgroundLibraryViewProps {
  searchQuery?: string;
}

function BackgroundCard({
  background,
}: {
  background: BackgroundMedia;
}): React.JSX.Element {
  return (
    <Card size="sm" data-testid={`bg-card-${background.id}`} className="py-0">
      <BackgroundPreview background={background} />
    </Card>
  );
}

/**
 * 배경 갤러리: 모든 배경을 한 격자에 보여 주고 종류(영상·이미지)와 상단 검색으로 거른다.
 * 배경 등록과 정리는 `scripts/importBackgrounds.mjs`로만 한다 (큰 영상은 Worker 요청
 * 본문 한도를 넘는다).
 *
 * 곡에 배경을 입히는 것은 편집기의 배경 선택 창에서 한다. 이 화면에는 '지금 편집 중인
 * 곡'이라는 맥락이 없기 때문이다.
 */
export function BackgroundLibraryView({
  searchQuery = "",
}: BackgroundLibraryViewProps): React.JSX.Element {
  const {
    catalog,
    kind,
    setKind,
    visibleBackgrounds,
    hasAnyBackground,
    emptyReason,
  } = useBackgroundGallery(searchQuery);
  const isOnline = useIsOnline();

  const isOffline = !isOnline || catalog.status === "offline";

  return (
    <div className="space-y-6">
      {isOffline && (
        <Alert role="status">
          <WifiOffIcon />
          <AlertDescription>{BACKGROUND_COPY.offline}</AlertDescription>
        </Alert>
      )}

      <section className="space-y-4">
        {hasAnyBackground && (
          <BackgroundKindFilter value={kind} onChange={setKind} />
        )}

        {emptyReason ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ImageIcon />
              </EmptyMedia>
              <EmptyTitle>
                {describeBackgroundGalleryEmpty(emptyReason, searchQuery)}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleBackgrounds.map((bg) => (
              <BackgroundCard key={bg.id} background={bg} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
