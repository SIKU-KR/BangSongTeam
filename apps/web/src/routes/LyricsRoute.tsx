import React from "react";
import { Navigate } from "react-router-dom";

/**
 * `/lyrics` — 레거시 경로 리다이렉트
 * 곡 라이브러리는 에디터 내부의 2-Pane 통합 곡 선택 모달(SongPickerModal)로 일원화되었으므로
 * `/presentations`로 리다이렉트합니다.
 */
export function LyricsRoute(): React.JSX.Element {
  return <Navigate to="/presentations" replace />;
}
