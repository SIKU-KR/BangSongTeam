import { SHELL_COPY } from "#copy/shell";

/**
 * 앱 코드를 읽지 못하는 브라우저에서 멈춘 로딩 화면 대신 업데이트 안내를 띄우는 인라인 스크립트.
 * 루트 레이아웃이 서버가 그린 로딩 화면(`#root`) 바로 뒤에 싣는다.
 *
 * Next.js와 의존 패키지가 내보내는 코드는 Safari·iOS 16.4부터 읽는 문법(클래스 static 블록, 정규식
 * lookbehind)을 쓴다. 그보다 오래된 브라우저(iOS 15에 머문 iPad·iPhone, macOS Catalina의 Safari)는
 * 청크를 읽지 못해 등록하지 못하고, Turbopack은 그 청크를 끝없이 기다려 React가 화면을 이어 그리지
 * 못한다. 그러면 '불러오는 중'만 남아 사용자는 네트워크 탓으로 안다.
 *
 * 같은 문법을 직접 읽어 보고 문법 오류(`SyntaxError`)일 때만 안내로 바꾼다. 앱을 띄울 수 있는
 * 브라우저에서는 DOM을 건드리지 않아 하이드레이션이 그대로다. 보안 정책이 문자열 실행을 막은
 * 것(`EvalError`)은 앱을 띄울 수 있는 브라우저일 수 있어 건드리지 않는다. 오래된 브라우저에서
 * 읽혀야 하므로 ES5로 쓰고, Safari 15.4 미만은 Tailwind의 `@layer`도 무시하므로 인라인 스타일로
 * 그린다.
 */
export const UNSUPPORTED_BROWSER_SCRIPT = `(function(){try{new Function("class A{static{}}");new RegExp("(?<=a)b");return}catch(e){if(!(e instanceof SyntaxError))return}var r=document.getElementById("root");if(!r)return;var p=document.createElement("p");p.setAttribute("role","alert");p.style.cssText="max-width:32rem;margin:30vh auto 0;padding:0 16px;text-align:center";p.textContent=${JSON.stringify(SHELL_COPY.unsupportedBrowser)};r.innerHTML="";r.appendChild(p)})()`;
