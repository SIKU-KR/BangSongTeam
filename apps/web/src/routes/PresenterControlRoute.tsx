import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { PROJECTION_SYNC } from "@repo/shared";
import type { BroadcastMessage, Presentation } from "@repo/shared";
import {
  usePresentationById,
  openPresentation,
  useNavigationBuffer,
  usePresentationShortcuts,
  useProjectionChannel,
  useElapsedTimer,
  openAudienceWindow,
  PresenterPreviewPanel,
  PresenterJumpPanel,
  PresenterControlBar,
  nextPosition,
  prevPosition,
  clampPosition,
  getTotalSlideCount,
  positionOfSlideNumber,
  INITIAL_POSITION,
  type ProjectionPosition,
} from "../features/presentation";

/** 문서를 찾지 못한 프레임에서 훅 본문이 참조할 빈 폴백 */
const EMPTY_PRESENTATION: Presentation = {
  id: "",
  userId: "",
  title: "",
  serviceDate: "",
  items: [],
  createdAt: "",
  updatedAt: "",
};

/**
 * 발표자 보기 조작 창 (`/present/:presentationId/control`, PRD 5 화면 목록).
 *
 * 이 창이 송출 상태의 **단일 원천**이다. 청중 창(`?audience=1`)은 여기서 보낸
 * BroadcastChannel 메시지만 따르고 스스로 판단하지 않는다. 두 창이 서로를
 * 고치려 들면 넘기는 순간 어느 쪽이 맞는지 알 수 없게 된다.
 *
 * 조작 창은 전체화면이 아니다. 조작자는 주소창이 보이는 창에서 다음 슬라이드와
 * 곡 목록을 보며 진행한다.
 */
export function PresenterControlRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const { presentationId } = useParams<{ presentationId: string }>();
  const found = usePresentationById(presentationId);
  const presentation = found ?? EMPTY_PRESENTATION;
  const songs = presentation.items;

  useLayoutEffect(() => {
    if (presentationId) openPresentation(presentationId);
  }, [presentationId]);

  const [position, setPosition] =
    useState<ProjectionPosition>(INITIAL_POSITION);
  const [isBlackout, setIsBlackout] = useState(false);
  const [isLyricsHidden, setIsLyricsHidden] = useState(false);
  const [invalidJump, setInvalidJump] = useState<string | null>(null);
  const [audienceMessage, setAudienceMessage] = useState<string | null>(null);

  const audienceWindowRef = useRef<Window | null>(null);
  const timer = useElapsedTimer();

  // 현재 상태를 항상 최신으로 읽기 위한 ref.
  // AUDIENCE_MOUNTED 응답은 채널 콜백에서 일어나는데, 콜백이 렌더 시점 값을
  // 붙들고 있으면 늦게 열린 송출 창에 옛 위치를 보내게 된다.
  const stateRef = useRef({ position, isBlackout, isLyricsHidden });
  stateRef.current = { position, isBlackout, isLyricsHidden };

  const handleMessage = useCallback(
    (message: BroadcastMessage) => {
      // 송출 창이 준비되면 즉시 현재 상태를 통째로 밀어 넣는다
      // (TECH_SPEC 5.3 핸드셰이크).
      if (message.type !== "AUDIENCE_MOUNTED") return;
      const snapshot = stateRef.current;
      postRef.current({
        type: "SYNC_SNAPSHOT",
        timestamp: Date.now(),
        payload: {
          presentationId: presentation.id,
          currentSongIndex: snapshot.position.songIndex,
          currentSlideIndex: snapshot.position.slideIndex,
          isBlackout: snapshot.isBlackout,
          isLyricsHidden: snapshot.isLyricsHidden,
        },
      });
    },
    [presentation.id],
  );

  const { post, peerState } = useProjectionChannel({
    onMessage: handleMessage,
  });

  // handleMessage가 post보다 먼저 정의되므로 ref를 거쳐 참조한다.
  const postRef = useRef(post);
  postRef.current = post;

  const applyPosition = useCallback(
    (next: ProjectionPosition) => {
      const clamped = clampPosition(next, songs);
      setPosition(clamped);
      post({
        type: "NAVIGATE_SLIDE",
        timestamp: Date.now(),
        payload: {
          songIndex: clamped.songIndex,
          slideIndex: clamped.slideIndex,
        },
      });
    },
    [post, songs],
  );

  const handleNext = useCallback(() => {
    applyPosition(nextPosition(stateRef.current.position, songs));
  }, [applyPosition, songs]);

  const handlePrev = useCallback(() => {
    applyPosition(prevPosition(stateRef.current.position, songs));
  }, [applyPosition, songs]);

  const handleJump = useCallback(
    (songIndex: number, slideIndex: number) => {
      applyPosition({ songIndex, slideIndex });
    },
    [applyPosition],
  );

  const handleToggleBlackout = useCallback(() => {
    const next = !stateRef.current.isBlackout;
    setIsBlackout(next);
    post({
      type: "SET_BLACKOUT",
      timestamp: Date.now(),
      payload: { isBlackout: next },
    });
  }, [post]);

  const handleToggleLyrics = useCallback(() => {
    const next = !stateRef.current.isLyricsHidden;
    setIsLyricsHidden(next);
    post({
      type: "SET_LYRICS_HIDDEN",
      timestamp: Date.now(),
      payload: { isLyricsHidden: next },
    });
  }, [post]);

  // 없는 번호 알림은 조작 창에만, 2초간 (PRD 5 / TECH_SPEC 5.2).
  const handleInvalidJump = useCallback((buffer: string) => {
    setInvalidJump(buffer);
  }, []);

  useEffect(() => {
    if (!invalidJump) return;
    const timeout = setTimeout(
      () => setInvalidJump(null),
      PROJECTION_SYNC.INVALID_JUMP_TOAST_MS,
    );
    return () => clearTimeout(timeout);
  }, [invalidJump]);

  // 숫자 키패드 점프 (N Enter = 세트 전체 N번째 슬라이드)
  const handleNumberJump = useCallback(
    (slideNumber: number) => {
      const target = positionOfSlideNumber(slideNumber, songs);
      if (target) applyPosition(target);
    },
    [applyPosition, songs],
  );

  const navBuffer = useNavigationBuffer({
    totalSlides: getTotalSlideCount(songs),
    onJump: handleNumberJump,
    onInvalidJump: handleInvalidJump,
  });

  const handleOpenAudience = useCallback(() => {
    void (async () => {
      const result = await openAudienceWindow(presentation.id);
      audienceWindowRef.current = result.window;
      setAudienceMessage(result.message);
    })();
  }, [presentation.id]);

  const handleExit = useCallback(() => {
    // 조작 창을 닫으면 청중 창도 함께 닫는다. 남겨 두면 프로젝터에 멈춘
    // 슬라이드가 그대로 떠 있게 된다.
    try {
      audienceWindowRef.current?.close();
    } catch {
      // 창이 이미 닫혔거나 접근할 수 없는 경우는 무시한다.
    }
    audienceWindowRef.current = null;
    navigate("/presentations");
  }, [navigate]);

  usePresentationShortcuts({
    onNext: handleNext,
    onPrev: handlePrev,
    onToggleBlackout: handleToggleBlackout,
    onToggleLyrics: handleToggleLyrics,
    // Esc로는 종료하지 않는다 (PRD 5: 종료는 종료 버튼으로만).
    onExit: undefined,
    navigationBuffer: navBuffer,
    enabled: true,
  });

  if (!found) return <Navigate to="/presentations" replace />;

  return (
    <div
      data-testid="presenter-control-route"
      className="h-screen w-full flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden"
    >
      <header className="flex items-baseline gap-3 px-4 py-3 border-b border-zinc-800">
        <h1 className="text-sm font-semibold truncate">{presentation.title}</h1>
        <span className="text-xs text-zinc-500">
          {presentation.serviceDate} · {songs.length}곡
        </span>
        <span className="ml-auto text-xs text-zinc-500">발표자 보기</span>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 p-4">
        <PresenterPreviewPanel
          songs={songs}
          position={position}
          isBlackout={isBlackout}
          isLyricsHidden={isLyricsHidden}
        />
        <PresenterJumpPanel
          songs={songs}
          position={position}
          onJump={handleJump}
        />
      </div>

      <PresenterControlBar
        isBlackout={isBlackout}
        isLyricsHidden={isLyricsHidden}
        onToggleBlackout={handleToggleBlackout}
        onToggleLyrics={handleToggleLyrics}
        onPrev={handlePrev}
        onNext={handleNext}
        onOpenAudience={handleOpenAudience}
        onExit={handleExit}
        buffer={navBuffer.buffer}
        invalidJump={invalidJump}
        peerState={peerState}
        audienceMessage={audienceMessage}
        elapsed={timer.elapsed}
        clock={timer.clock}
      />
    </div>
  );
}
