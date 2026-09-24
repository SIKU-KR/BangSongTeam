import React from "react";
import { DriveBrowser } from "../features/drive";

/** `/presentations/trash` — 휴지통 (복원·영구 삭제) */
export function TrashRoute(): React.JSX.Element {
  return <DriveBrowser mode="trash" />;
}
