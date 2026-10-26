"use client";

import React from "react";
import { useSession } from "../lib/auth";
import { ShareJoinRoute } from "./ShareJoinRoute";
import { SharePreviewRoute } from "./SharePreviewRoute";

/**
 * 공유 링크(`/s/:token`). 로그인한 사람은 멤버로 들어가 편집기로 가고, 로그인하지 않은
 * 사람은 보기 전용 미리보기를 본다.
 */
export function ShareRoute(): React.JSX.Element {
  const session = useSession();
  return session.status === "authenticated" ? (
    <ShareJoinRoute />
  ) : (
    <SharePreviewRoute />
  );
}
