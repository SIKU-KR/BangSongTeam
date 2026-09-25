import React, { Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "#components/theme-provider";
import { RouteErrorBoundary } from "./components/common/RouteErrorBoundary";
import {
  hydrateFromStorage,
  flushPendingWrites,
} from "./features/presentation";
import { hydrateSongLibrary } from "./features/editor/songLibraryStore";
import { hydrateFoldersFromStorage } from "./features/drive/folderStore";
import { hydrateBackgroundCatalog } from "./features/backgrounds/backgroundCatalog";
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
import {
  AppShellLayout,
  LandingRoute,
  PresentationsRoute,
  TrashRoute,
  LyricsRoute,
  BackgroundsRoute,
  EditorRoute,
  FullscreenPresentRoute,
  LoginRoute,
  ShareJoinRoute,
  SharePreviewRoute,
} from "./routes";

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
      await Promise.all([
        hydrateFromStorage(),
        hydrateSongLibrary(),
        hydrateFoldersFromStorage(),
        hydrateBackgroundCatalog(),
      ]);
      if (cancelled) return;
      setBootstrappedUserId(userId);

      if (shouldRunBootSync(window.location.pathname)) void runBootSync();
    })();
    return () => {
      cancelled = true;
    };
  }, [session.status, userId, bootstrappedUserId]);

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

  return (
    isSessionResolved &&
    (session.status !== "authenticated" || bootstrappedUserId === userId)
  );
}

/** 예전 자체 테마 저장 키를 그대로 써서 사용자가 고른 테마를 잃지 않는다 */
export const THEME_STORAGE_KEY = "worship-theme";

/** App 최상위 라우팅 컴포넌트 */
export function App(): React.JSX.Element {
  return (
    <ThemeProvider defaultTheme="system" storageKey={THEME_STORAGE_KEY}>
      <AppRoutes />
    </ThemeProvider>
  );
}

function AppRoutes(): React.JSX.Element {
  const isHydrated = useHydration();
  const session = useSession();

  if (!isHydrated) {
    return (
      <LoadingScreen testId="app-hydrating">
        저장된 프레젠테이션을 불러오는 중…
      </LoadingScreen>
    );
  }

  if (session.status !== "authenticated") return <GuestRoutes />;

  return (
    <AppProviders>
      <BrowserRouter>
        <RouteErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<LandingRoute />} />

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
              <Route path="/s/:token" element={<ShareJoinRoute />} />
              <Route
                path="/present/:presentationId/fullscreen"
                element={<FullscreenPresentRoute />}
              />
              <Route
                path="*"
                element={<Navigate to="/presentations" replace />}
              />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </BrowserRouter>
    </AppProviders>
  );
}

/**
 * 로그인하지 않았을 때. 공유 링크 보기와 그 세트의 발표만 열고,
 * 나머지 주소는 로그인 화면을 보여 준다 (로그인하면 그 주소로 이어진다).
 */
function GuestRoutes(): React.JSX.Element {
  return (
    <AppProviders>
      <BrowserRouter>
        <RouteErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/s/:token" element={<SharePreviewRoute />} />
              <Route
                path="/present/:presentationId/fullscreen"
                element={<FullscreenPresentRoute />}
              />
              <Route path="*" element={<LoginRoute />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </BrowserRouter>
    </AppProviders>
  );
}

function LoadingScreen({
  testId,
  children,
}: {
  testId: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      data-testid={testId}
      className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

/** 나뉜 라우트 청크를 받는 동안 보이는 화면 */
function RouteFallback(): React.JSX.Element {
  return (
    <LoadingScreen testId="route-loading">화면을 불러오는 중…</LoadingScreen>
  );
}

function AppProviders({
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
