import type { Metadata } from "next";
import { App } from "../client/App";
import { UNSUPPORTED_BROWSER_SCRIPT } from "../client/lib/browser/unsupportedBrowser";
import { THEME_INIT_SCRIPT } from "../client/lib/theme";
import { APP_NAME, APP_TAGLINE } from "../shared/copy/app";
import "../client/index.css";

/**
 * 화면마다 제목을 달아(`src/app`의 각 `page.tsx`) 편집기·송출·약관을 여러 탭에 열어도 탭과 화면
 * 낭독기가 화면을 가를 수 있게 한다. 제목을 달지 않은 화면(랜딩)은 앱 이름만 쓴다.
 */
export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
  icons: { icon: { url: "/icons/icon-192.png", type: "image/png" } },
};

/**
 * 모든 화면의 HTML 뼈대. 화면은 브라우저 저장소(IndexedDB)의 프레젠테이션을 그리므로
 * 서버는 로딩 화면만 그리고, 나머지는 클라이언트 루트(`App`)가 이어 그린다.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <div id="root">
          <App>{children}</App>
        </div>
        <script
          dangerouslySetInnerHTML={{ __html: UNSUPPORTED_BROWSER_SCRIPT }}
        />
      </body>
    </html>
  );
}
