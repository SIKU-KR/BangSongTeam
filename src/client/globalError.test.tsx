import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlobalError from "../app/global-error";
import { SHELL_COPY } from "#copy/shell";

describe("global-error", () => {
  it("루트 레이아웃이 깨지면 영어 기본 화면 대신 한국어 새로고침 안내를 제 문서로 그린다", () => {
    const html = renderToStaticMarkup(<GlobalError />);

    expect(html).toMatch(/^<html lang="ko">/);
    expect(html).toContain("<body>");
    expect(html).toContain(SHELL_COPY.routeError.title);
    expect(html).toContain(SHELL_COPY.routeError.reload);
    expect(html).not.toMatch(/couldn.t load/i);
  });
});
