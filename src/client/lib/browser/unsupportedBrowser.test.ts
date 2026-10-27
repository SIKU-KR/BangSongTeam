import type React from "react";
import { Children, isValidElement } from "react";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RootLayout from "../../../app/layout";
import { UNSUPPORTED_BROWSER_SCRIPT } from "./unsupportedBrowser";
import { SHELL_COPY } from "#copy/shell";

type LayoutElement = React.ReactElement<{
  id?: string;
  children?: React.ReactNode;
  dangerouslySetInnerHTML?: { __html: string };
}>;

function childrenOf(element: LayoutElement): LayoutElement[] {
  return Children.toArray(element.props.children).filter(
    (child): child is LayoutElement => isValidElement(child),
  );
}

function runWith(
  failure?: unknown,
  global: "Function" | "RegExp" = "Function",
): void {
  const run = new Function(UNSUPPORTED_BROWSER_SCRIPT);
  if (failure !== undefined) {
    vi.stubGlobal(global, function () {
      throw failure;
    });
  }
  try {
    run();
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("UNSUPPORTED_BROWSER_SCRIPT", () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="root"><div data-testid="app-hydrating">불러오는 중…</div></div>';
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("클래스 static 블록을 읽지 못하는 브라우저면 멈춘 로딩 화면 대신 업데이트 안내를 띄운다", () => {
    runWith(new SyntaxError("Unexpected token '{'"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      SHELL_COPY.unsupportedBrowser,
    );
    expect(screen.queryByTestId("app-hydrating")).toBeNull();
  });

  it("정규식 lookbehind를 읽지 못하는 브라우저도 안내한다", () => {
    runWith(new SyntaxError("Invalid regular expression"), "RegExp");

    expect(screen.getByRole("alert")).toHaveTextContent(
      SHELL_COPY.unsupportedBrowser,
    );
  });

  it("앱을 띄울 수 있는 브라우저에서는 아무것도 바꾸지 않는다", () => {
    runWith();

    expect(screen.getByTestId("app-hydrating")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("보안 정책이 문자열 실행을 막아 확인하지 못하면 안내하지 않는다", () => {
    runWith(new EvalError("Refused to evaluate a string"));

    expect(screen.getByTestId("app-hydrating")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("루트 레이아웃은 로딩 화면 바로 뒤에 이 스크립트를 싣는다", () => {
    const html = RootLayout({ children: null }) as LayoutElement;
    const body = childrenOf(html).find((child) => child.type === "body");
    const [root, script] = childrenOf(body!);

    expect(root.props.id).toBe("root");
    expect(script.type).toBe("script");
    expect(script.props.dangerouslySetInnerHTML?.__html).toBe(
      UNSUPPORTED_BROWSER_SCRIPT,
    );
  });
});
