import { lazy } from "react";

/**
 * 첫 화면 번들에서 뺀 라우트. 편집기(react-moveable·색 선택·글꼴 목록),
 * 드라이브(@dnd-kit), 로그인 화면은 그 주소를 처음 열 때 청크를 받는다.
 * 나뉜 청크도 서비스 워커가 모두 프리캐시하므로 오프라인에서 열린다.
 *
 * 송출 화면(`FullscreenPresentRoute`)은 송출 중 요청 0건 규칙 때문에 나누지 않고
 * 메인 청크에 둔다.
 */
export const AppShellLayout = lazy(() =>
  import("./AppShellLayout").then((m) => ({ default: m.AppShellLayout })),
);
export const PresentationsRoute = lazy(() =>
  import("./PresentationsRoute").then((m) => ({
    default: m.PresentationsRoute,
  })),
);
export const TrashRoute = lazy(() =>
  import("./TrashRoute").then((m) => ({ default: m.TrashRoute })),
);
export const LyricsRoute = lazy(() =>
  import("./LyricsRoute").then((m) => ({ default: m.LyricsRoute })),
);
export const BackgroundsRoute = lazy(() =>
  import("./BackgroundsRoute").then((m) => ({ default: m.BackgroundsRoute })),
);
const loadEditorRoute = () => import("./EditorRoute");

/** 공유 미리보기가 세트를 받는 동안 편집기 청크도 함께 받도록 미리 불러 둔다 */
export function preloadEditorRoute(): void {
  void loadEditorRoute();
}

export const EditorRoute = lazy(() =>
  loadEditorRoute().then((m) => ({ default: m.EditorRoute })),
);
export const LoginRoute = lazy(() =>
  import("./LoginRoute").then((m) => ({ default: m.LoginRoute })),
);
export const SharePreviewRoute = lazy(() =>
  import("./SharePreviewRoute").then((m) => ({
    default: m.SharePreviewRoute,
  })),
);
