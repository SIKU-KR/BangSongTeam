import React from "react";
import { DriveBrowser } from "../features/drive";

/** 휴지통 라우트 */
export function TrashRoute(): React.JSX.Element {
  return <DriveBrowser mode="trash" />;
}
