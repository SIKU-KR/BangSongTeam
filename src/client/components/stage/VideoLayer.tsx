import React, { useState, useEffect, useRef } from "react";

export interface VideoLayerProps {
  src?: string;
  nextSrc?: string;
  posterUrl?: string;
  className?: string;
}

/**
 * A/B 교차 루프를 지원하는 배경 비디오 레이어.
 *
 * `src`가 사라지면(배경 없음·이미지 배경 곡으로 넘어감) 재생 중이던 슬롯을 비운다.
 * 비우지 않으면 앞 곡의 영상이 다음 곡 뒤에서 계속 보인다.
 */
export function VideoLayer({
  src,
  nextSrc,
  posterUrl,
  className = "",
}: VideoLayerProps): React.JSX.Element {
  const [activeSlot, setActiveSlot] = useState<"A" | "B">("A");
  const [srcA, setSrcA] = useState<string | undefined>(src);
  const [srcB, setSrcB] = useState<string | undefined>(undefined);

  const videoARef = useRef<HTMLVideoElement | null>(null);
  const videoBRef = useRef<HTMLVideoElement | null>(null);
  const currentSrcRef = useRef<string | undefined>(src);

  useEffect(() => {
    if (src === currentSrcRef.current) {
      return;
    }

    currentSrcRef.current = src;

    if (!src) {
      if (activeSlot === "A") setSrcA(undefined);
      else setSrcB(undefined);
      return;
    }

    if (activeSlot === "A") {
      setSrcB(src);
      setActiveSlot("B");
      setTimeout(() => {
        videoBRef.current?.play().catch(() => {});
      }, 0);
    } else {
      setSrcA(src);
      setActiveSlot("A");
      setTimeout(() => {
        videoARef.current?.play().catch(() => {});
      }, 0);
    }
  }, [src, activeSlot]);

  return (
    <div
      data-testid="video-layer-container"
      className={`pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black select-none ${className}`}
    >
      <video
        ref={videoARef}
        data-testid="video-slot-a"
        src={srcA}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster={posterUrl}
        className="absolute inset-0 size-full object-cover"
        style={{
          opacity: activeSlot === "A" && srcA ? 1 : 0,
          transition: "opacity 200ms ease-in-out",
          willChange: "opacity",
        }}
      />

      <video
        ref={videoBRef}
        data-testid="video-slot-b"
        src={srcB}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster={posterUrl}
        className="absolute inset-0 size-full object-cover"
        style={{
          opacity: activeSlot === "B" && srcB ? 1 : 0,
          transition: "opacity 200ms ease-in-out",
          willChange: "opacity",
        }}
      />

      {nextSrc && (
        <video
          data-testid="video-preload"
          src={nextSrc}
          preload="auto"
          muted
          playsInline
          className="hidden"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
