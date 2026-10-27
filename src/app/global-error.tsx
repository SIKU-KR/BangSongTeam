"use client";

import { RouteErrorScreen } from "../client/components/common/RouteErrorScreen";
import { SHELL_COPY } from "../client/copy/shell";
import { APP_NAME } from "../shared/copy/app";
import "../client/index.css";

/**
 * 루트 레이아웃(`App`)이 깨졌을 때 Next.js 기본 영어 오류 화면 대신 보이는 새로고침 안내.
 * 루트 레이아웃을 대신하므로 `<html>`·`<body>`와 전역 스타일을 직접 둔다. 깨졌을 수 있는 앱
 * 상태에 기대지 않도록 `App`·`ThemeProvider`를 가져오지 않는다.
 */
export default function GlobalError(): React.JSX.Element {
  return (
    <html lang="ko">
      <head>
        <title>{APP_NAME}</title>
      </head>
      <body>
        <RouteErrorScreen description={SHELL_COPY.rootError.description} />
      </body>
    </html>
  );
}
