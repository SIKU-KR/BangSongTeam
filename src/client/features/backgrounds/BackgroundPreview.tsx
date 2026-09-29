import React, { useEffect, useRef, useState } from "react";
import { FilmIcon, ImageIcon } from "lucide-react";
import { cn } from "cn";
import type { BackgroundMedia } from "#shared";
import { BACKGROUND_COPY } from "#copy/backgrounds";

export interface BackgroundPreviewProps {
  background: BackgroundMedia;
  className?: string;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 요소가 화면(스크롤 영역)에 보이는 동안 true. 관찰할 수 없는 환경에서는 늘 false */
function useIsVisible(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const elem = ref.current;
    if (!enabled || !elem || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? false),
    );
    observer.observe(elem);
    return () => {
      observer.disconnect();
      setVisible(false);
    };
  }, [ref, enabled]);

  return visible;
}

/**
 * 배경 카드의 16:9 미리보기 영역.
 *
 * 영상은 카드가 화면에 보이는 동안만 자동 재생하고, 벗어나면 `<video>`를 내려
 * 내려받기도 멈춘다. 목록 전체가 한꺼번에 영상을 받지 않게 하기 위해서다.
 * 동작 줄이기 설정을 켠 사용자에게는 포스터만 보인다.
 */
export function BackgroundPreview({
  background,
  className,
}: BackgroundPreviewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === background.posterUrl;
  const isVideo = background.kind === "video";
  const visible = useIsVisible(
    containerRef,
    isVideo && !failed && !prefersReducedMotion(),
  );

  return (
    <div
      ref={containerRef}
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
      {visible && (
        <video
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
        className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-sm bg-black/70 px-1.5 py-0.5 text-2xs font-semibold text-white/90 [&_svg]:size-3"
      >
        {isVideo ? <FilmIcon aria-hidden /> : <ImageIcon aria-hidden />}
        {isVideo ? BACKGROUND_COPY.video : BACKGROUND_COPY.image}
      </span>

      {isVideo && background.durationSec > 0 && (
        <span className="absolute right-1.5 bottom-1.5 rounded-sm bg-black/70 px-1.5 py-0.5 font-mono text-2xs text-white/90">
          {BACKGROUND_COPY.seconds(background.durationSec)}
        </span>
      )}
    </div>
  );
}
