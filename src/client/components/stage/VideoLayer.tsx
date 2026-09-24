import React, { useState, useEffect, useRef } from "react";

export interface VideoLayerProps {
  src?: string;
  nextSrc?: string;
  posterUrl?: string;
  className?: string;
}

/** A/B 교차 루프를 지원하는 배경 비디오 레이어 */
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
      className={`absolute inset-0 overflow-hidden bg-black z-0 select-none pointer-events-none ${className}`}
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
        className="absolute inset-0 w-full h-full object-cover"
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
        className="absolute inset-0 w-full h-full object-cover"
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
