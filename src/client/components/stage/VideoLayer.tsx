import React, { useState, useEffect, useRef } from "react";

interface VideoLayerProps {
  src?: string;
  nextSrc?: string;
  posterUrl?: string;
  onReveal?: () => void;
}

type Slot = "A" | "B";

const SLOTS: readonly Slot[] = ["A", "B"];

/** 곡 사이 배경 교차 전환 시간. 아래에 깔아 둔 이미지도 이만큼 더 두었다가 걷어 낸다 */
export const FADE_MS = 200;

/**
 * 새 영상의 첫 프레임을 기다리는 최대 시간. 넘기면 준비가 덜 됐어도 전환한다.
 * 오래 기다리면 가사는 바뀌었는데 배경은 앞 곡에 머무는 시간이 길어진다.
 */
export const FIRST_FRAME_TIMEOUT_MS = 1000;

/**
 * 재생하려는데 데이터가 모자란 상태가 이만큼 이어지고 그동안 재생 위치도 그대로면 영상을 다시 불러온다.
 * 데이터가 조금이라도 들어오면(`progress`) 처음부터 다시 잰다. 느리게라도 받고 있는 영상을
 * 다시 불러오면 받은 데이터를 버리고 처음부터 다시 받게 된다.
 */
export const STALL_RELOAD_MS = 5000;

/** 첫 복구 재시도 간격. 실패할 때마다 두 배로 늘려 같은 파일을 연달아 요청하지 않는다 */
export const RETRY_BASE_MS = 1000;

/** 복구 재시도 간격의 상한. 예배 내내 늦어도 이 간격으로는 다시 시도한다 */
export const RETRY_MAX_MS = 15000;

/**
 * 이만큼 끊김 없이 재생되어야 재시도 간격을 처음으로 되돌린다.
 * 첫 프레임 직후 오류나 버퍼링이 되풀이되면 간격이 계속 늘어나야 요청이 몰리지 않는다.
 */
export const HEALTHY_PLAYBACK_MS = 5000;

type Timer = ReturnType<typeof setTimeout>;

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
 * 새 영상이 보이기 시작하면(첫 프레임 또는 제한 시간) `onReveal`을 한 번 부른다.
 * 이미지 배경을 영상 아래에 깔아 두었다가 이때 걷어 내야 전환에 검은 화면이 끼지 않는다.
 * 같은 곡 안의 슬라이드 이동은 `src`가 그대로라 영상이 끊기지 않는다.
 *
 * `src`가 사라지면(배경 없음·이미지 배경 곡으로 넘어감) 재생 중이던 슬롯을 비운다.
 * 비우지 않으면 앞 곡의 영상이 다음 곡 뒤에서 계속 보인다.
 *
 * 새 슬롯은 앞 슬롯 위에 올라와 서서히 나타나고, 앞 슬롯은 전환이 끝날 때까지
 * 불투명하게 남는다. 두 슬롯을 함께 흐리게 하면 전환 중간에 화면이 어두워진다.
 *
 * 보이는 슬롯은 스스로 복구한다. 디스플레이 재연결·GPU 리셋 뒤의 디코드 오류,
 * '저장된 배경으로 시작'에서 받던 영상의 네트워크 오류, 오래 이어지는 버퍼링은
 * 간격을 늘려 가며 다시 불러오고, 멈추면 다시 재생한다. 같은 배경이 다음 곡에도
 * 이어지면 `src`가 바뀌지 않아 이것 말고는 다시 불러올 계기가 없다.
 * 다시 불러오면 지금 프레임이 사라지므로, 재생이 다시 시작되면 예약해 둔 다시 불러오기를
 * 취소하고, 오프라인일 때 멈춘 영상은 다시 연결될 때까지 마지막 프레임을 그대로 둔다.
 * 일부러 멈춘 영상(자동 재생 차단 등)은 버퍼링으로 보지 않는다.
 * 자동 재생이 막힌 경우는 키 입력·클릭(사용자 활성화) 때 다시 재생을 시도한다.
 */
export function VideoLayer({
  src,
  nextSrc,
  posterUrl,
  onReveal,
}: VideoLayerProps): React.JSX.Element {
  const [slotSrc, setSlotSrc] = useState(() => initialSlots(src, nextSrc));
  const [activeSlot, setActiveSlot] = useState<Slot>("A");
  const [pendingSlot, setPendingSlot] = useState<Slot | null>(null);

  const videoARef = useRef<HTMLVideoElement | null>(null);
  const videoBRef = useRef<HTMLVideoElement | null>(null);
  const currentSrcRef = useRef<string | undefined>(src);
  const onRevealRef = useRef(onReveal);

  useEffect(() => {
    onRevealRef.current = onReveal;
  }, [onReveal]);

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
      onRevealRef.current?.();
    };

    video.addEventListener("playing", reveal);
    const timer = setTimeout(reveal, FIRST_FRAME_TIMEOUT_MS);
    if (
      !video.paused &&
      video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      queueMicrotask(reveal);
    } else {
      if (video.error) video.load();
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
    if (!video) return;

    let failures = 0;
    let reloadTimer: Timer | undefined;
    let stallTimer: Timer | undefined;
    let healthyTimer: Timer | undefined;
    let reloadWhenVisible = false;
    let reloadWhenOnline = false;

    const canPlay = (): boolean => video.isConnected && !document.hidden;

    const isStarved = (): boolean =>
      !video.paused && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;

    const resume = (): void => {
      if (video.paused && canPlay()) video.play().catch(() => {});
    };

    const reloadNow = (): void => {
      reloadTimer = undefined;
      if (!canPlay()) {
        reloadWhenVisible = true;
        return;
      }
      video.load();
      video.play().catch(() => {});
    };

    const scheduleReload = (): void => {
      clearTimeout(stallTimer);
      stallTimer = undefined;
      clearTimeout(healthyTimer);
      if (reloadTimer !== undefined || reloadWhenVisible) return;
      const delay = Math.min(RETRY_BASE_MS * 2 ** failures, RETRY_MAX_MS);
      failures += 1;
      reloadTimer = setTimeout(reloadNow, delay);
    };

    const watchStall = (): void => {
      clearTimeout(stallTimer);
      const stalledAt = video.currentTime;
      stallTimer = setTimeout(() => {
        stallTimer = undefined;
        if (!isStarved()) return;
        if (video.currentTime !== stalledAt) watchStall();
        else if (!navigator.onLine) reloadWhenOnline = true;
        else scheduleReload();
      }, STALL_RELOAD_MS);
    };

    const onStall = (): void => {
      clearTimeout(healthyTimer);
      healthyTimer = undefined;
      if (stallTimer !== undefined || reloadTimer !== undefined) return;
      watchStall();
    };

    const onProgress = (): void => {
      if (stallTimer !== undefined) watchStall();
    };

    const onOnline = (): void => {
      if (!reloadWhenOnline) return;
      reloadWhenOnline = false;
      if (isStarved()) scheduleReload();
    };

    const onPlaying = (): void => {
      clearTimeout(stallTimer);
      stallTimer = undefined;
      clearTimeout(reloadTimer);
      reloadTimer = undefined;
      reloadWhenVisible = false;
      reloadWhenOnline = false;
      clearTimeout(healthyTimer);
      healthyTimer = setTimeout(() => {
        failures = 0;
      }, HEALTHY_PLAYBACK_MS);
    };

    const onVisibilityChange = (): void => {
      if (document.hidden) return;
      if (reloadWhenVisible) {
        reloadWhenVisible = false;
        reloadNow();
      } else {
        resume();
      }
    };

    video.addEventListener("error", scheduleReload);
    video.addEventListener("waiting", onStall);
    video.addEventListener("stalled", onStall);
    video.addEventListener("progress", onProgress);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", resume);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("keydown", resume, true);
    window.addEventListener("pointerdown", resume, true);
    window.addEventListener("online", onOnline);

    if (video.error) {
      scheduleReload();
    } else {
      resume();
      if (isStarved()) onStall();
    }

    return () => {
      video.removeEventListener("error", scheduleReload);
      video.removeEventListener("waiting", onStall);
      video.removeEventListener("stalled", onStall);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", resume);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("keydown", resume, true);
      window.removeEventListener("pointerdown", resume, true);
      window.removeEventListener("online", onOnline);
      clearTimeout(reloadTimer);
      clearTimeout(stallTimer);
      clearTimeout(healthyTimer);
    };
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
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"
    >
      {SLOTS.map((slot) => {
        const isActive = activeSlot === slot;
        return (
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
              opacity: isActive && slotSrc[slot] ? 1 : 0,
              zIndex: isActive ? 1 : 0,
              transition: isActive
                ? `opacity ${FADE_MS}ms ease-in-out`
                : `opacity 0ms linear ${FADE_MS}ms`,
              willChange: "opacity",
            }}
          />
        );
      })}
    </div>
  );
}
