import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./features/theme";
import {
  hydrateFromStorage,
  flushPendingWrites,
} from "./features/presentation";
import { hydrateSongLibrary } from "./features/editor";
import { hydrateSession, useSession } from "./lib/auth";
import { LoginRoute } from "./routes/LoginRoute";
import {
  AppShellLayout,
  LandingRoute,
  PresentationsRoute,
  LyricsRoute,
  BackgroundsRoute,
  EditorRoute,
  FullscreenPresentRoute,
} from "./routes";

/**
 * 저장소에서 프레젠테이션·보관함을 복원한 뒤에만 라우터를 렌더한다.
 *
 * 먼저 렌더하고 나중에 교체하면 시드 데이터가 한 프레임 보였다가 사라지고,
 * 그 사이 사용자가 누른 편집이 저장본을 덮어쓸 수 있다.
 */
function useHydration(): boolean {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 세션을 먼저 확정한 다음 스토어를 싣는다. 두 하이드레이션 모두
      // 세션 사용자로 문서를 거르므로 순서가 뒤집히면 빈 목록이 나온다.
      //
      // hydrateSession()은 캐시가 있으면 서버를 기다리지 않는다.
      // 예배 당일 네트워크가 끊겨도 여기서 멈추면 안 된다.
      const session = await hydrateSession();
      if (session.status === "authenticated") {
        await Promise.all([hydrateFromStorage(), hydrateSongLibrary()]);
      }
      if (!cancelled) setIsHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 창이 숨겨지거나 종료될 때 대기 중인 쓰기를 앞당긴다.
  // IndexedDB는 비동기라 완료를 보장할 수 없어, 디바운스를 짧게 유지하는 것으로 보완한다.
  useEffect(() => {
    const flush = (): void => {
      void flushPendingWrites();
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return isHydrated;
}

/**
 * App 최상위 라우팅 컴포넌트 (React Router Library Mode)
 * - `/`                              : 랜딩 페이지 (준비 중)
 * - `/presentations`                 : 프레젠테이션 대시보드 (AppShell)
 * - `/lyrics`                        : 레거시 경로 → `/presentations` 리다이렉트
 * - `/backgrounds`                   : 배경 라이브러리 (AppShell)
 * - `/editor/:presentationId`        : 프레젠테이션 단위 편집기
 * - `/present/:presentationId/fullscreen` : 청중용 단독 전체화면 송출
 */
export function App(): React.JSX.Element {
  const isHydrated = useHydration();
  const session = useSession();

  if (!isHydrated) {
    return (
      <ThemeProvider>
        <div
          data-testid="app-hydrating"
          className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 text-sm"
        >
          저장된 프레젠테이션을 불러오는 중…
        </div>
      </ThemeProvider>
    );
  }

  // 로그인은 편집의 전제 조건이다 (2026-09-22 결정). 미인증이면 어떤
  // 경로로 들어와도 로그인 화면만 보인다.
  if (session.status !== "authenticated") {
    return (
      <ThemeProvider>
        <LoginRoute />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingRoute />} />

          {/* 공유 셸(사이드바 + 히어로 헤더) 아래 중첩 라우트.
              path 없는 레이아웃 라우트라 자식들은 절대 경로를 그대로 유지한다. */}
          <Route element={<AppShellLayout />}>
            <Route path="/presentations" element={<PresentationsRoute />} />
            <Route path="/lyrics" element={<LyricsRoute />} />
            <Route path="/backgrounds" element={<BackgroundsRoute />} />
          </Route>

          <Route path="/editor/:presentationId" element={<EditorRoute />} />
          <Route
            path="/present/:presentationId/fullscreen"
            element={<FullscreenPresentRoute />}
          />
          <Route path="*" element={<Navigate to="/presentations" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
