import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./features/theme";
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
 * App 최상위 라우팅 컴포넌트 (React Router Library Mode)
 * - `/`                              : 랜딩 페이지 (준비 중)
 * - `/presentations`                 : 프레젠테이션 대시보드 (AppShell)
 * - `/lyrics`                        : 곡 라이브러리 (AppShell)
 * - `/backgrounds`                   : 배경 라이브러리 (AppShell)
 * - `/editor/:presentationId`        : 프레젠테이션 단위 편집기
 * - `/present/:presentationId/fullscreen` : 청중용 단독 전체화면 송출
 */
export function App(): React.JSX.Element {
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
