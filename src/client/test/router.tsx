import React from "react";
import {
  TestParamsContext,
  getLastNavigationType,
  usePathname,
  type TestNavigationType,
} from "./next/navigation";

interface RouteProps {
  /** `/editor/:presentationId` 꼴. 없으면 `layout`으로 자식 경로를 감싼다 */
  path?: string;
  element?: React.ReactNode;
  layout?: React.ComponentType<{ children: React.ReactNode }>;
  children?: React.ReactNode;
}

/** 선언용. 실제로 그리는 것은 `Routes`다 */
export function Route(props: RouteProps): null {
  void props;
  return null;
}

function matchPath(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  if (pattern === "*") return {};
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (const [index, segment] of expected.entries()) {
    const value = actual[index] as string;
    if (segment.startsWith(":")) params[segment.slice(1)] = value;
    else if (segment !== value) return null;
  }
  return params;
}

interface RouteMatch {
  node: React.ReactNode;
  params: Record<string, string>;
}

function findMatch(
  routes: React.ReactNode,
  pathname: string,
): RouteMatch | null {
  for (const child of React.Children.toArray(routes)) {
    if (!React.isValidElement<RouteProps>(child)) continue;
    const { path, element, layout: Layout, children } = child.props;
    if (path === undefined && Layout) {
      const inner = findMatch(children, pathname);
      if (inner) return { ...inner, node: <Layout>{inner.node}</Layout> };
      continue;
    }
    if (path === undefined) continue;
    const params = matchPath(path, pathname);
    if (params === null) continue;
    return {
      node: <React.Fragment key={path}>{element}</React.Fragment>,
      params,
    };
  }
  return null;
}

/**
 * Next.js 파일 라우트를 흉내 내는 테스트용 경로 표. 지금 주소에 맞는 첫 `Route`를 그리고
 * 동적 값을 `useParams`에 넘긴다. 경로 없는 `Route`의 `layout`은 이동해도 유지된다.
 */
export function Routes({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const pathname = usePathname();
  const match = findMatch(children, pathname);
  return (
    <TestParamsContext.Provider value={match?.params ?? {}}>
      {match?.node}
    </TestParamsContext.Provider>
  );
}

/** 테스트 시작 주소를 정하고 자식을 그린다 */
export function MemoryRouter({
  initialEntries = ["/"],
  children,
}: {
  initialEntries?: string[];
  children: React.ReactNode;
}): React.JSX.Element {
  const [entry] = React.useState(() => {
    const first = initialEntries[0] ?? "/";
    window.history.replaceState(null, "", first);
    return first;
  });
  return <React.Fragment key={entry}>{children}</React.Fragment>;
}

/** 지금 주소를 그대로 쓰고 자식을 그린다 */
export function BrowserRouter({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return <>{children}</>;
}

/** 이 화면으로 온 이동이 push·replace·뒤로 가기 중 무엇이었는지 */
export function useNavigationType(): TestNavigationType {
  usePathname();
  return getLastNavigationType();
}
