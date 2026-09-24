import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./features/theme";
import {
  hydrateFromStorage,
  flushPendingWrites,
} from "./features/presentation";
import { hydrateSongLibrary } from "./features/editor";
import { hydrateFoldersFromStorage } from "./features/drive";
import { hydrateSession, useSession } from "./lib/auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { createAppQueryClient } from "./lib/api/queryClient";
import {
  runBootSync,
  shouldRunBootSync,
  flushPendingSync,
  flushDeckSync,
  flushFolderSync,
} from "./lib/sync";
import { LoginRoute } from "./routes/LoginRoute";
import {
  AppShellLayout,
  LandingRoute,
  PresentationsRoute,
  TrashRoute,
  LyricsRoute,
  BackgroundsRoute,
  EditorRoute,
  FullscreenPresentRoute,
  WorshipReadyRoute,
} from "./routes";

/**
 * 부팅 순서.
 *
 * 1. 세션을 확정한다 (캐시가 있으면 서버를 기다리지 않는다 — 예배 당일
 *    네트워크가 끊겨도 여기서 멈추면 안 된다)
 * 2. 로그인된 사용자의 로컬 문서를 싣는다
 * 3. 화면을 그린 뒤 백그라운드로 서버와 병합한다
 *
 * **사용자별 부트스트랩은 로그인 시점마다 다시 돈다.** 게이트를 통과한 뒤
 * 로그인한 경우(개발자 로그인·OAuth 콜백 복귀)에도 스토어를 싣고 동기화를
 * 켜야 한다. 부팅 때 한 번만 돌리면 방금 로그인한 사용자는 새로고침하기
 * 전까지 서버에 아무것도 올라가지 않는다.
 */
function useHydration(): boolean {
  const [isSessionResolved, setIsSessionResolved] = useState(false);
  const [bootstrappedUserId, setBootstrappedUserId] = useState<string | null>(
    null,
  );
  const session = useSession();
  const userId = session.user?.userId ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateSession();
      if (!cancelled) setIsSessionResolved(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (session.status !== "authenticated" || !userId) return;
    if (bootstrappedUserId === userId) return;

    let cancelled = false;
    void (async () => {
      // 하이드레이션은 모두 세션 사용자로 문서를 거르므로 세션이 먼저다.
      await Promise.all([
        hydrateFromStorage(),
        hydrateSongLibrary(),
        hydrateFoldersFromStorage(),
      ]);
      if (cancelled) return;
      setBootstrappedUserId(userId);

      // 서버 병합은 화면을 그린 뒤 백그라운드로 돌린다. 네트워크가 느린
      // 교회에서 첫 화면이 그만큼 늦어지면 안 된다.
      //
      // 송출 화면으로 바로 열린 창(새로고침한 전체화면 송출 등)에서는 돌리지 않는다.
      // 동기화가 꺼진 채로 남으므로 그 창에서는 서버 push도 일어나지 않는다.
      if (shouldRunBootSync(window.location.pathname)) void runBootSync();
    })();
    return () => {
      cancelled = true;
    };
  }, [session.status, userId, bootstrappedUserId]);

  // 창이 숨겨지거나 종료될 때 대기 중인 쓰기를 앞당긴다.
  // IndexedDB는 비동기라 완료를 보장할 수 없어, 디바운스를 짧게 유지하는 것으로 보완한다.
  useEffect(() => {
    const flush = (): void => {
      void flushPendingWrites();
      void flushFolderSync();
      void flushPendingSync();
      void flushDeckSync();
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

  // 미인증이면 스토어를 실을 것이 없으므로 세션 확정만으로 충분하다.
  return (
    isSessionResolved &&
    (session.status !== "authenticated" || bootstrappedUserId === userId)
  );
}

/**
 * App 최상위 라우팅 컴포넌트 (React Router Library Mode)
 * - `/`                              : 랜딩 페이지 (준비 중)
 * - `/presentations`                 : 내 드라이브 (폴더·프레젠테이션, AppShell)
 * - `/presentations/folders/:id`     : 드라이브 폴더
 * - `/presentations/trash`           : 휴지통
 * - `/lyrics`                        : 레거시 경로 → `/presentations` 리다이렉트
 * - `/backgrounds`                   : 배경 라이브러리 (AppShell)
 * - `/editor/:presentationId`        : 프레젠테이션 단위 편집기
 * - `/present/:presentationId/ready`      : 예배 준비 (오프라인 캐시)
 * - `/present/:presentationId/fullscreen` : 청중용 전체화면 송출
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
      <AuthedProviders>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingRoute />} />

            {/* 공유 셸(사이드바 + 히어로 헤더) 아래 중첩 라우트.
              path 없는 레이아웃 라우트라 자식들은 절대 경로를 그대로 유지한다. */}
            <Route element={<AppShellLayout />}>
              <Route path="/presentations" element={<PresentationsRoute />} />
              <Route
                path="/presentations/folders/:folderId"
                element={<PresentationsRoute />}
              />
              <Route path="/presentations/trash" element={<TrashRoute />} />
              <Route path="/lyrics" element={<LyricsRoute />} />
              <Route path="/backgrounds" element={<BackgroundsRoute />} />
            </Route>

            <Route path="/editor/:presentationId" element={<EditorRoute />} />
            <Route
              path="/present/:presentationId/ready"
              element={<WorshipReadyRoute />}
            />
            <Route
              path="/present/:presentationId/fullscreen"
              element={<FullscreenPresentRoute />}
            />
            <Route
              path="*"
              element={<Navigate to="/presentations" replace />}
            />
          </Routes>
        </BrowserRouter>
      </AuthedProviders>
    </ThemeProvider>
  );
}

/**
 * 로그인 뒤에만 필요한 공급자.
 *
 * QueryClient는 스스로 요청하지 않는다. 훅(곡 추가 모달의 공유 라이브러리 검색 등)이
 * 쓸 때만 요청이 나간다. 송출 화면은 그 훅을 import하지 않으므로(ESLint 가드)
 * 이 공급자가 있어도 Zero-Fetch는 유지된다.
 */
function AuthedProviders({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [queryClient] = useState(createAppQueryClient);
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

export default App;
