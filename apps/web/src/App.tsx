import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./features/theme";
import { HomeRoute } from "./routes";
import { FullscreenPresentRoute } from "./routes/FullscreenPresentRoute";
import { EditorRoute } from "./routes/EditorRoute";

/**
 * App 최상위 라우팅 컴포넌트 (React Router Library Mode)
 * - `/` : 메인 홈 진입 화면 (Canva/MiriCanvas 스타일 프레젠테이션 목록 및 템플릿)
 * - `/editor` : Canva/MiriCanvas 스타일 프레젠테이션 편집기
 * - `/present/fullscreen` : 청중용 단독 전체화면 송출 페이지
 */
export function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/editor" element={<EditorRoute />} />
          <Route
            path="/present/fullscreen"
            element={<FullscreenPresentRoute />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
