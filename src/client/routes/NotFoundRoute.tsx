"use client";

import React from "react";
import { Navigate } from "../components/common/Navigate";
import { DRIVE_ROOT_PATH } from "../features/drive/drivePaths";

/**
 * 없는 주소. 로그인한 사람은 내 드라이브로 보낸다. 로그인하지 않은 사람에게는 앱 루트가
 * 이 화면 대신 로그인 화면을 보여 준다.
 */
export function NotFoundRoute(): React.JSX.Element {
  return <Navigate to={DRIVE_ROOT_PATH} />;
}
