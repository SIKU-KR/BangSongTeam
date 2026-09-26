import React, { useState } from "react";
import { cn } from "cn";
import type { BackgroundMedia } from "#shared";

export interface BackgroundPreviewProps {
  background: BackgroundMedia;
  /** 마우스를 올린 동안만 영상을 재생한다. 목록 전체가 영상을 받지 않게 한다 */
  playing?: boolean;
  className?: string;
}

/** 배경 카드의 16:9 미리보기 영역 */
export function BackgroundPreview({
  background,
  playing = false,
  className,
}: BackgroundPreviewProps): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === background.posterUrl;

  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden bg-black select-none",
        className,
      )}
    >
      {failed ? (
        <div
          data-testid={`bg-preview-missing-${background.id}`}
          className="absolute inset-0 flex items-center justify-center px-3 text-center text-2xs text-white/60"
        >
          미리보기를 불러오지 못했습니다
        </div>
      ) : playing && background.kind === "video" ? (
        <video
          src={background.mediaUrl}
          poster={background.posterUrl}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 size-full object-cover"
        />
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

      <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
        {background.kind === "video" ? (
          background.durationSec > 0 && (
            <span className="rounded-sm bg-black/70 px-1.5 py-0.5 font-mono text-2xs text-white/90">
              {background.durationSec}초
            </span>
          )
        ) : (
          <span className="rounded-sm bg-black/70 px-1.5 py-0.5 text-2xs font-semibold text-white/90">
            이미지
          </span>
        )}
      </div>
    </div>
  );
}
