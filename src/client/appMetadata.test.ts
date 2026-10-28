import type { Metadata } from "next";
import { describe, expect, it } from "vitest";
import { metadata as rootMetadata } from "../app/layout";
import { metadata as drive } from "../app/(shell)/presentations/page";
import { metadata as folder } from "../app/(shell)/presentations/folders/[folderId]/page";
import { metadata as trash } from "../app/(shell)/presentations/trash/page";
import { metadata as backgrounds } from "../app/(shell)/backgrounds/page";
import { metadata as editor } from "../app/editor/[presentationId]/page";
import { metadata as projection } from "../app/present/[presentationId]/fullscreen/page";
import { metadata as share } from "../app/s/[token]/page";
import { metadata as terms } from "../app/terms/page";
import { metadata as privacy } from "../app/privacy/page";
import { APP_NAME } from "#shared";
import { LEGAL_COPY } from "#copy/auth";
import { COMMON_COPY } from "#copy/common";
import { SHELL_COPY } from "#copy/shell";

describe("화면 제목", () => {
  it("루트 레이아웃은 화면 제목 뒤에 앱 이름을 붙이고, 제목이 없는 화면은 앱 이름만 쓴다", () => {
    expect(rootMetadata.title).toEqual({
      default: APP_NAME,
      template: `%s · ${APP_NAME}`,
    });
  });

  it.each<[string, Metadata, string]>([
    ["내 드라이브", drive, COMMON_COPY.myDrive],
    ["폴더", folder, COMMON_COPY.myDrive],
    ["휴지통", trash, COMMON_COPY.trash],
    ["배경 갤러리", backgrounds, SHELL_COPY.backgroundGallery],
    ["편집기", editor, SHELL_COPY.pageTitle.editor],
    ["송출", projection, SHELL_COPY.pageTitle.projection],
    ["공유 링크", share, SHELL_COPY.pageTitle.share],
    ["이용약관", terms, LEGAL_COPY.terms],
    ["개인정보 처리방침", privacy, LEGAL_COPY.privacy],
  ])("%s 화면은 제 제목을 가진다", (_, metadata, title) => {
    expect(metadata.title).toBe(title);
  });

  it("편집기·송출·공유 링크 화면의 제목은 서로 다르다", () => {
    const titles = new Set([
      SHELL_COPY.pageTitle.editor,
      SHELL_COPY.pageTitle.projection,
      SHELL_COPY.pageTitle.share,
    ]);
    expect(titles.size).toBe(3);
  });
});
