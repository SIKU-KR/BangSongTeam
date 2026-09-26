import React, { useState, useEffect, useRef } from "react";

export interface VideoLayerProps {
  src?: string;
  nextSrc?: string;
  posterUrl?: string;
  className?: string;
}

type Slot = "A" | "B";

const SLOTS: readonly Slot[] = ["A", "B"];

const FADE_MS = 200;

/**
 * 새 영상의 첫 프레임을 기다리는 최대 시간. 넘기면 준비가 덜 됐어도 전환한다.
 * 오래 기다리면 가사는 바뀌었는데 배경은 앞 곡에 머무는 시간이 길어진다.
 */
export const FIRST_FRAME_TIMEOUT_MS = 1000;

function otherSlot(slot: Slot): Slot {
  return slot === "A" ? "B" : "A";
}

function initialSlots(
  src: string | undefined,
  nextSrc: string | undefined,
): Record<Slot, string | undefined> {
  return { A: src, B: nextSrc !== src ? nextSrc : undefined };
}

/**
 * A/B 두 슬롯으로 곡 사이를 교차 전환하는 배경 비디오 레이어.
 *
 * 쉬고 있는 슬롯에 다음 곡 영상(`nextSrc`)을 일시정지 상태로 미리 실어 두고,
 * 곡이 바뀌면 그 슬롯을 재생해 `playing`(첫 프레임 준비)을 받은 뒤에야 보이게 한다.
 * 그 사이에는 앞 곡 영상이 그대로 보이므로 검은 화면이나 포스터가 끼지 않는다.
 * 같은 곡 안의 슬라이드 이동은 `src`가 그대로라 영상이 끊기지 않는다.
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
  const [slotSrc, setSlotSrc] = useState(() => initialSlots(src, nextSrc));
  const [activeSlot, setActiveSlot] = useState<Slot>("A");
  const [pendingSlot, setPendingSlot] = useState<Slot | null>(null);

  const videoARef = useRef<HTMLVideoElement | null>(null);
  const videoBRef = useRef<HTMLVideoElement | null>(null);
  const currentSrcRef = useRef<string | undefined>(src);

  const videoOf = (slot: Slot): HTMLVideoElement | null =>
    slot === "A" ? videoARef.current : videoBRef.current;

  useEffect(() => {
    if (src === currentSrcRef.current) return;
    currentSrcRef.current = src;

    if (!src) {
      setPendingSlot(null);
      setSlotSrc((prev) => ({ ...prev, [activeSlot]: undefined }));
      return;
    }

    const target = otherSlot(activeSlot);
    setSlotSrc((prev) =>
      prev[target] === src ? prev : { ...prev, [target]: src },
    );
    setPendingSlot(target);
  }, [src, activeSlot]);

  const pendingSrc = pendingSlot ? slotSrc[pendingSlot] : undefined;

  useEffect(() => {
    if (!pendingSlot || !pendingSrc) return;
    const video = videoOf(pendingSlot);
    if (!video) return;

    let settled = false;
    const reveal = (): void => {
      if (settled) return;
      settled = true;
      setActiveSlot(pendingSlot);
      setPendingSlot(null);
    };

    video.addEventListener("playing", reveal);
    const timer = setTimeout(reveal, FIRST_FRAME_TIMEOUT_MS);
    if (
      !video.paused &&
      video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      queueMicrotask(reveal);
    } else {
      video.play().catch(() => {});
    }

    return () => {
      settled = true;
      video.removeEventListener("playing", reveal);
      clearTimeout(timer);
    };
  }, [pendingSlot, pendingSrc]);

  const activeSrc = slotSrc[activeSlot];

  useEffect(() => {
    if (!activeSrc) return;
    const video = videoOf(activeSlot);
    if (video?.paused) video.play().catch(() => {});
  }, [activeSlot, activeSrc]);

  useEffect(() => {
    if (pendingSlot) return;
    const idle = otherSlot(activeSlot);
    const timer = setTimeout(() => {
      videoOf(idle)?.pause();
      if (nextSrc && nextSrc !== src) {
        setSlotSrc((prev) =>
          prev[idle] === nextSrc ? prev : { ...prev, [idle]: nextSrc },
        );
      }
    }, FADE_MS);
    return () => clearTimeout(timer);
  }, [activeSlot, pendingSlot, nextSrc, src]);

  return (
    <div
      data-testid="video-layer-container"
      className={`pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black select-none ${className}`}
    >
      {SLOTS.map((slot) => (
        <video
          key={slot}
          ref={slot === "A" ? videoARef : videoBRef}
          data-testid={`video-slot-${slot.toLowerCase()}`}
          src={slotSrc[slot]}
          muted
          loop
          playsInline
          preload="auto"
          poster={posterUrl}
          className="absolute inset-0 size-full object-cover"
          style={{
            opacity: activeSlot === slot && slotSrc[slot] ? 1 : 0,
            transition: `opacity ${FADE_MS}ms ease-in-out`,
            willChange: "opacity",
          }}
        />
      ))}
    </div>
  );
}
