import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { HomeRoute } from "./routes";
import { FullscreenPresentRoute } from "./routes/FullscreenPresentRoute";

/**
 * App 최상위 라우팅 컴포넌트 (React Router Library Mode)
 * - `/` : 메인 홈 진입 화면 (M1 송출 시작, 가사 빠른 입력)
 * - `/present/fullscreen` : 청중용 단독 전체화면 송출 페이지
 */
export function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route
          path="/present/fullscreen"
          element={<FullscreenPresentRoute />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
