"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "#components/theme-provider";
import { LoadingScreen } from "./components/common/LoadingScreen";
import { RouteErrorBoundary } from "./components/common/RouteErrorBoundary";
import {
  hydrateFromStorage,
  flushPendingWrites,
} from "./features/presentation";
import { isProjectionPath } from "./features/presentation/fullscreen";
import { hydrateSongLibrary } from "./features/editor/songLibraryStore";
import { hydrateFoldersFromStorage } from "./features/drive/folderStore";
import { hydrateBackgroundCatalog } from "./features/backgrounds/backgroundCatalog";
import {
  getCurrentUserId,
  hydrateSession,
  resumeDeferredSessionWork,
  setAccountHooks,
  useSession,
} from "./lib/auth";
import { ConsentGate } from "./features/auth/ConsentGate";
import { QueryClientProvider } from "@tanstack/react-query";
import { createAppQueryClient } from "./lib/api/queryClient";
import { flushClientReports } from "./lib/observability/clientReports";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import {
  startBootSync,
  runDeferredBootSync,
  flushBeforeSignOut,
  flushPendingSync,
  flushDeckSync,
  flushFolderSync,
  stopAccountSync,
  startSyncRecovery,
  resumeDeferredSyncRecovery,
} from "./lib/sync";
import { THEME_STORAGE_KEY } from "#lib/theme";
import { SHELL_COPY } from "#copy/shell";
import { ERROR_COPY } from "#copy/common";

/** 로그인 화면은 손님에게만 보이므로 그 주소를 처음 열 때 청크를 받는다 */
const LoginRoute = dynamic(() =>
  import("./routes/LoginRoute").then((m) => m.LoginRoute),
);

function useHydration(): boolean {
  const [isSessionResolved, setIsSessionResolved] = useState(false);
  const [bootstrappedUserId, setBootstrappedUserId] = useState<string | null>(
    null,
  );
  const session = useSession();
  const userId = session.user?.userId ?? null;

  useEffect(() => {
    const controller = new AbortController();
    setAccountHooks({ flushBeforeSignOut, stopAccountSync });
    void (async () => {
      await hydrateSession();
      if (!controller.signal.aborted) setIsSessionResolved(true);
    })();
    return () => {
      controller.abort();
      setAccountHooks(null);
    };
  }, []);

  useEffect(() => {
    if (session.status !== "authenticated" || !userId) return;
    if (bootstrappedUserId === userId) return;

    const controller = new AbortController();
    void (async () => {
      await Promise.all([
        hydrateFromStorage(),
        hydrateSongLibrary(),
        hydrateFoldersFromStorage(),
        hydrateBackgroundCatalog(),
      ]);
      if (controller.signal.aborted || getCurrentUserId() !== userId) return;
      startBootSync(window.location.pathname);
      setBootstrappedUserId(userId);
    })();
    return () => controller.abort();
  }, [session.status, userId, bootstrappedUserId]);

  useFlushOnPageHide();
  useSyncRecovery();

  return (
    isSessionResolved &&
    session.status !== "loading" &&
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
      flushClientReports();
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

function useSyncRecovery(): void {
  useEffect(
    () =>
      startSyncRecovery({
        isPaused: () => isProjectionPath(window.location.pathname),
      }),
    [],
  );
}

/** 손님에게도 열리는 주소. 랜딩, 공유 링크 보기와 그 세트의 송출, 약관 */
const GUEST_PATH =
  /^\/(s\/[^/]+|present\/[^/]+\/fullscreen|terms|privacy)?\/?$/;

function isGuestPath(pathname: string): boolean {
  return GUEST_PATH.test(pathname);
}

/**
 * 모든 페이지를 감싸는 클라이언트 루트. 주소별 화면은 `src/app`의 파일 라우트가 정하고,
 * 이 컴포넌트는 세션·로컬 저장소를 불러오는 동안의 로딩 화면과 로그인 여부에 따른
 * 화면 선택을 맡는다.
 *
 * 송출 중에 세션이 끊겨도 로그인한 트리를 그대로 둔다. 트리를 바꾸면 송출 화면이 다시
 * 마운트되어 관객 화면이 첫 슬라이드로 돌아가거나 로그인 화면이 뜬다. 송출을 마치고 다른
 * 주소로 나가면 그때 손님 트리로 바꾼다. 트리를 바꿀 때는 Query 캐시도 새로 만들어 앞
 * 사용자의 서버 데이터가 남지 않게 한다. 송출 주소의 로딩 화면은 새로고침 중에도
 * 프로젝터가 흰 화면으로 번쩍이지 않게 검게만 그린다.
 *
 * 계정이 끝나면(로그아웃·세션 만료·다른 계정) 세션이 다시 `loading`이 되고, 동기화를 끄고
 * 새로고침할 때까지 로딩 화면이 앞 계정의 화면을 덮는다. 계정이 끝날 때 할 동기화 쪽 일은 세션
 * 스토어가 `lib/sync`를 가져오지 못해 여기서 등록한다(`setAccountHooks`).
 */
export function App({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  useEffect(() => {
    registerServiceWorker();
    if (process.env.NODE_ENV === "development") void import("react-grab");
  }, []);

  return (
    <ThemeProvider defaultTheme="system" storageKey={THEME_STORAGE_KEY}>
      <AppGate>{children}</AppGate>
    </ThemeProvider>
  );
}

function AppGate({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const pathname = usePathname();
  const isHydrated = useHydration();
  const session = useSession();
  const isAuthenticated = session.status === "authenticated";
  const [wasAuthenticated, setWasAuthenticated] = useState(false);
  const releaseProjectionLatch = useCallback(
    () => setWasAuthenticated(false),
    [],
  );

  const isOnProjection = isProjectionPath(pathname);

  if (isAuthenticated && !wasAuthenticated) setWasAuthenticated(true);
  if (!isAuthenticated && wasAuthenticated && !isOnProjection) {
    setWasAuthenticated(false);
  }

  if (!isHydrated) {
    return (
      <LoadingScreen testId="app-hydrating">
        {SHELL_COPY.hydrating}
      </LoadingScreen>
    );
  }

  if (isAuthenticated || (wasAuthenticated && isOnProjection)) {
    return (
      <AppFrame
        key="authenticated"
        overlay={<ConsentGate />}
        onLeaveProjection={isAuthenticated ? undefined : releaseProjectionLatch}
      >
        {children}
      </AppFrame>
    );
  }

  return (
    <AppFrame key="guest">
      {isGuestPath(pathname) ? (
        children
      ) : (
        <LoginRoute
          description={
            session.reason === "expired" ? ERROR_COPY.sessionExpired : undefined
          }
        />
      )}
    </AppFrame>
  );
}

function ProjectionLatchGate({
  onLeave,
  children,
}: {
  onLeave?: () => void;
  children: React.ReactNode;
}): React.JSX.Element | null {
  const pathname = usePathname();
  const isOnProjection = isProjectionPath(pathname);
  const hasLeft = onLeave !== undefined && !isOnProjection;

  useEffect(() => {
    if (hasLeft) onLeave();
  }, [hasLeft, onLeave]);

  useEffect(() => {
    if (isOnProjection) return;
    resumeDeferredSessionWork();
    runDeferredBootSync();
    resumeDeferredSyncRecovery();
    flushClientReports();
  }, [isOnProjection]);

  return hasLeft ? null : <>{children}</>;
}

function AppFrame({
  children,
  overlay,
  onLeaveProjection,
}: {
  children: React.ReactNode;
  overlay?: React.ReactNode;
  onLeaveProjection?: () => void;
}): React.JSX.Element {
  const [queryClient] = useState(createAppQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <ProjectionLatchGate onLeave={onLeaveProjection}>
            {children}
          </ProjectionLatchGate>
        </Suspense>
      </RouteErrorBoundary>
      {overlay}
    </QueryClientProvider>
  );
}

/** 화면 청크를 받는 동안 보이는 화면 */
function RouteFallback(): React.JSX.Element {
  return (
    <LoadingScreen testId="route-loading">
      {SHELL_COPY.routeLoading}
    </LoadingScreen>
  );
}
