import React, { useState } from "react";
import { FilmIcon, HardDriveIcon, ImageIcon } from "lucide-react";
import { cn } from "cn";
import type { BackgroundMedia } from "#shared";
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { useIsMediaCached } from "./useIsMediaCached";

export interface BackgroundPreviewProps {
  background: BackgroundMedia;
  /** 키보드 포커스처럼 카드 바깥에서 정한 재생 여부. 마우스를 올려도 재생한다 */
  active?: boolean;
  className?: string;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 배경 카드의 16:9 미리보기 영역.
 *
 * 평소에는 포스터만 보이고, 마우스를 올리거나 키보드로 고른(`active`) 카드 하나만
 * `<video>`를 붙여 재생한다. 배경 영상은 원본(최대 수백 MB, 1080p)이라 보이는 카드마다
 * 재생하면 목록을 여는 것만으로 대역폭을 다 쓴다. 벗어나면 `<video>`를 내려 내려받기도
 * 멈춘다. 터치 입력과 동작 줄이기 설정을 켠 사용자에게는 포스터만 보인다.
 *
 * 원본이 이미 기기 캐시에 있으면 '기기에 저장됨'을 표시해, 받지 않고 바로 송출하거나
 * 오프라인에서 쓸 배경을 고를 수 있게 한다.
 */
export function BackgroundPreview({
  background,
  active = false,
  className,
}: BackgroundPreviewProps): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const failed = failedUrl === background.posterUrl;
  const isVideo = background.kind === "video";
  const isSaved = useIsMediaCached(background.mediaUrl);
  const playing =
    isVideo && !failed && (hovered || active) && !prefersReducedMotion();

  return (
    <div
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      className={cn(
        "relative aspect-video w-full overflow-hidden bg-black select-none",
        className,
      )}
    >
      {failed ? (
        <div
          data-testid={`bg-preview-missing-${background.id}`}
          role="img"
          aria-label={background.title}
          className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-white/60"
        >
          {BACKGROUND_COPY.previewFailed}
        </div>
      ) : (
        <img
          src={background.posterUrl}
          alt={background.title}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(background.posterUrl)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {playing && (
        <video
          data-testid={`bg-preview-video-${background.id}`}
          src={background.mediaUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 size-full object-cover"
        />
      )}

      <span
        data-testid={`bg-kind-${background.id}`}
        className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-sm bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white/90 [&_svg]:size-3"
      >
        {isVideo ? <FilmIcon aria-hidden /> : <ImageIcon aria-hidden />}
        {isVideo ? BACKGROUND_COPY.video : BACKGROUND_COPY.image}
      </span>

      {isSaved && (
        <span
          data-testid={`bg-saved-${background.id}`}
          className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-sm bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white/90 [&_svg]:size-3"
        >
          <HardDriveIcon aria-hidden />
          {BACKGROUND_COPY.saved}
        </span>
      )}

      {isVideo && background.durationSec > 0 && (
        <span className="absolute right-1.5 bottom-1.5 rounded-sm bg-black/70 px-1.5 py-0.5 font-mono text-xs text-white/90">
          {BACKGROUND_COPY.seconds(background.durationSec)}
        </span>
      )}
    </div>
  );
}
