import React, { Suspense, useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { ThemeProvider } from "#components/theme-provider";
import { RouteErrorBoundary } from "./components/common/RouteErrorBoundary";
import {
  hydrateFromStorage,
  flushPendingWrites,
} from "./features/presentation";
import { isProjectionPath } from "./features/presentation/fullscreen";
import { hydrateSongLibrary } from "./features/editor/songLibraryStore";
import { hydrateFoldersFromStorage } from "./features/drive/folderStore";
import { hydrateBackgroundCatalog } from "./features/backgrounds/backgroundCatalog";
import { hydrateSession, useSession } from "./lib/auth";
import { ConsentGate } from "./features/auth/ConsentGate";
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
  TermsRoute,
  PrivacyRoute,
} from "./routes";
import { SHELL_COPY } from "#copy/shell";

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

  useFlushOnPageHide();

  return (
    isSessionResolved &&
    (session.status !== "authenticated" || bootstrappedUserId === userId)
  );
}

function useFlushOnPageHide(): void {
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
}

/** 예전 자체 테마 저장 키를 그대로 써서 사용자가 고른 테마를 잃지 않는다 */
const THEME_STORAGE_KEY = "worship-theme";

/** App 최상위 라우팅 컴포넌트 */
export function App(): React.JSX.Element {
  return (
    <ThemeProvider defaultTheme="system" storageKey={THEME_STORAGE_KEY}>
      <AppRoutes />
    </ThemeProvider>
  );
}

/**
 * 송출 중에 세션이 끊겨도 로그인한 라우트 트리를 그대로 둔다. 트리를 바꾸면 송출
 * 라우트가 다시 마운트되어 관객 화면이 첫 슬라이드로 돌아가거나 로그인 화면이 뜬다.
 * 송출을 마치고 다른 주소로 나가면 그때 손님 트리로 바꾼다.
 */
function AppRoutes(): React.JSX.Element {
  const isHydrated = useHydration();
  const session = useSession();
  const isAuthenticated = session.status === "authenticated";
  const [wasAuthenticated, setWasAuthenticated] = useState(false);
  const releaseProjectionLatch = useCallback(
    () => setWasAuthenticated(false),
    [],
  );

  if (isAuthenticated && !wasAuthenticated) setWasAuthenticated(true);

  if (!isHydrated) {
    return (
      <LoadingScreen testId="app-hydrating">
        {SHELL_COPY.hydrating}
      </LoadingScreen>
    );
  }

  if (isAuthenticated) return <AuthenticatedRoutes />;

  if (wasAuthenticated && isProjectionPath(window.location.pathname)) {
    return <AuthenticatedRoutes onLeaveProjection={releaseProjectionLatch} />;
  }

  return <GuestRoutes />;
}

function AuthenticatedRoutes({
  onLeaveProjection,
}: {
  onLeaveProjection?: () => void;
}): React.JSX.Element {
  return (
    <AppRouter
      overlay={
        <>
          <ConsentGate />
          {onLeaveProjection && (
            <ProjectionLeaveWatcher onLeave={onLeaveProjection} />
          )}
        </>
      }
    >
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
      <Route path="/terms" element={<TermsRoute />} />
      <Route path="/privacy" element={<PrivacyRoute />} />
      <Route path="*" element={<Navigate to="/presentations" replace />} />
    </AppRouter>
  );
}

/**
 * 로그인하지 않았을 때. 랜딩, 공유 링크 보기와 그 세트의 발표만 열고,
 * 나머지 주소는 로그인 화면을 보여 준다 (로그인하면 그 주소로 이어진다).
 */
function GuestRoutes(): React.JSX.Element {
  return (
    <AppRouter>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/s/:token" element={<SharePreviewRoute />} />
      <Route
        path="/present/:presentationId/fullscreen"
        element={<FullscreenPresentRoute />}
      />
      <Route path="/terms" element={<TermsRoute />} />
      <Route path="/privacy" element={<PrivacyRoute />} />
      <Route path="*" element={<LoginRoute />} />
    </AppRouter>
  );
}

function ProjectionLeaveWatcher({ onLeave }: { onLeave: () => void }): null {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!isProjectionPath(pathname)) onLeave();
  }, [pathname, onLeave]);
  return null;
}

function AppRouter({
  children,
  overlay,
}: {
  children: React.ReactNode;
  overlay?: React.ReactNode;
}): React.JSX.Element {
  return (
    <AppProviders>
      <BrowserRouter>
        <RouteErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>{children}</Routes>
          </Suspense>
        </RouteErrorBoundary>
        {overlay}
      </BrowserRouter>
    </AppProviders>
  );
}

/** 송출 주소에서는 새로고침 중에도 프로젝터가 흰 화면으로 번쩍이지 않게 검은 화면만 그린다 */
function LoadingScreen({
  testId,
  children,
}: {
  testId: string;
  children: React.ReactNode;
}): React.JSX.Element {
  if (isProjectionPath(window.location.pathname)) {
    return (
      <div data-testid={testId} className="min-h-screen bg-black">
        <span className="sr-only">{children}</span>
      </div>
    );
  }

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
    <LoadingScreen testId="route-loading">
      {SHELL_COPY.routeLoading}
    </LoadingScreen>
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
