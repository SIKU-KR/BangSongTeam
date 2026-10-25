"use client";

import React from "react";
import { Navigate } from "../components/common/Navigate";

/** 레거시 곡 라이브러리 경로 리다이렉트 라우트 */
export function LyricsRoute(): React.JSX.Element {
  return <Navigate to="/presentations" />;
}
