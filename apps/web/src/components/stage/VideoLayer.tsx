import React, { useState, useEffect, useRef } from "react";

export interface VideoLayerProps {
  /** 현재 재생할 배경 비디오 URL (H.264 MP4 loop) */
  src?: string;
  /** 다음 곡 사전 로드용 비디오 URL */
  nextSrc?: string;
  /** 비디오 로딩 전 표시할 포스터 이미지 */
  posterUrl?: string;
  className?: string;
}

/**
 * 3-Layer Stage Layer 1: 무결점 무지연 Video A/B 교차 루프 레이어
 * 동일 곡 내 슬라이드 전환 시 비디오 리셋 없이 끊김 없는 루프를 유지하며,
 * 곡 전환 시 2개의 비디오 태그 간 0.2초(200ms) 크로스페이드로 검은 화면(Black Flicker)을 방지한다.
 */
export function VideoLayer({
  src,
  nextSrc,
  posterUrl,
  className = "",
}: VideoLayerProps): React.JSX.Element {
  // A/B 슬롯 관리: 'A' 또는 'B'가 현재 활성 슬롯
  const [activeSlot, setActiveSlot] = useState<"A" | "B">("A");
  const [srcA, setSrcA] = useState<string | undefined>(src);
  const [srcB, setSrcB] = useState<string | undefined>(undefined);

  const videoARef = useRef<HTMLVideoElement | null>(null);
  const videoBRef = useRef<HTMLVideoElement | null>(null);
  const currentSrcRef = useRef<string | undefined>(src);

  useEffect(() => {
    // 소스가 동일하면 리셋 없이 루프 유지
    if (src === currentSrcRef.current) {
      return;
    }

    currentSrcRef.current = src;

    if (!src) {
      return;
    }

    if (activeSlot === "A") {
      // 슬롯 B에 새 소스 탑재 및 전환
      setSrcB(src);
      setActiveSlot("B");
      // 약간의 지연 후 재생 시도 (DOM 마운트 반영)
      setTimeout(() => {
        videoBRef.current?.play().catch(() => {});
      }, 0);
    } else {
      // 슬롯 A에 새 소스 탑재 및 전환
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
      {/* Video Slot A */}
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

      {/* Video Slot B */}
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

      {/* 다음 곡 사전 로드 (Hidden) */}
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
