import React from "react";
import { render, type RenderResult } from "@testing-library/react";
import { App } from "../App";
import NotFound from "../../app/not-found";
import { TestParamsContext, usePathname } from "./next/navigation";

type PageModule = { default: React.ComponentType };
type LayoutModule = {
  default: React.ComponentType<{ children: React.ReactNode }>;
};

const pageModules = import.meta.glob<PageModule>("../../app/**/page.tsx", {
  eager: true,
});
const layoutModules = import.meta.glob<LayoutModule>(
  "../../app/*/**/layout.tsx",
  { eager: true },
);

interface AppRoute {
  segments: string[];
  Page: React.ComponentType;
  layouts: { key: string; Layout: LayoutModule["default"] }[];
}

const APP_DIR = "../../app";

function routeSegments(dir: string): string[] {
  return dir
    .split("/")
    .filter(Boolean)
    .filter((segment) => !/^\(.*\)$/.test(segment));
}

const ROUTES: AppRoute[] = Object.entries(pageModules).map(([file, mod]) => {
  const dir = file.slice(APP_DIR.length, -"/page.tsx".length);
  const dirs = dir.split("/").filter(Boolean);
  const layouts = dirs.flatMap((_, index) => {
    const key = `${APP_DIR}/${dirs.slice(0, index + 1).join("/")}/layout.tsx`;
    const layout = layoutModules[key];
    return layout ? [{ key, Layout: layout.default }] : [];
  });
  return { segments: routeSegments(dir), Page: mod.default, layouts };
});

function matchRoute(
  pathname: string,
): { route: AppRoute; params: Record<string, string> } | null {
  const actual = pathname.split("/").filter(Boolean);
  const candidates = [...ROUTES].sort(
    (a, b) =>
      a.segments.filter((s) => s.startsWith("[")).length -
      b.segments.filter((s) => s.startsWith("[")).length,
  );
  for (const route of candidates) {
    if (route.segments.length !== actual.length) continue;
    const params: Record<string, string> = {};
    const ok = route.segments.every((segment, index) => {
      const value = actual[index] as string;
      if (segment.startsWith("[")) {
        params[segment.slice(1, -1)] = value;
        return true;
      }
      return segment === value;
    });
    if (ok) return { route, params };
  }
  return null;
}

/** `src/app`의 파일 라우트를 그대로 읽어 지금 주소의 레이아웃·페이지를 그린다 */
function FileRoutes(): React.JSX.Element {
  const pathname = usePathname();
  const match = matchRoute(pathname);
  if (!match) return <NotFound />;
  const { route, params } = match;
  const page = (
    <route.Page key={`${route.segments.join("/")}:${JSON.stringify(params)}`} />
  );
  const tree = route.layouts.reduceRight<React.ReactNode>(
    (children, { key, Layout }) => <Layout key={key}>{children}</Layout>,
    page,
  );
  return (
    <TestParamsContext.Provider value={params}>
      {tree}
    </TestParamsContext.Provider>
  );
}

/** 주소 `path`에서 앱 전체(클라이언트 루트 + 파일 라우트)를 그린다 */
export function renderApp(path: string): RenderResult {
  window.history.replaceState(null, "", path);
  return render(
    <App>
      <FileRoutes />
    </App>,
  );
}
