import { describe, expect, it } from "vitest";
import { API_ERRORS } from "#shared";
import { AUTH_COPY } from "./auth";
import { BACKGROUND_COPY } from "./backgrounds";
import { COMMON_COPY, ERROR_COPY } from "./common";
import { DRIVE_COPY } from "./drive";
import { EDITOR_COPY, SHORTCUT_GUIDE } from "./editor";
import { FOLDER_COPY } from "./folders";
import { PRESENTATION_COPY } from "./presentation";
import { SHARE_LINK_COPY } from "./shareLink";
import { SHARING_COPY } from "./sharing";
import { SHELL_COPY } from "./shell";

const COPY_MODULES = {
  API_ERRORS,
  AUTH_COPY,
  BACKGROUND_COPY,
  COMMON_COPY,
  ERROR_COPY,
  DRIVE_COPY,
  EDITOR_COPY,
  SHORTCUT_GUIDE,
  FOLDER_COPY,
  PRESENTATION_COPY,
  SHARE_LINK_COPY,
  SHARING_COPY,
  SHELL_COPY,
};

const FORMAL_ENDING = /(습니다|십시오|하세요|하시겠습니까)[.?!]?$/;

const collectSentences = (value: unknown): string[] => {
  if (typeof value === "string") {
    return value
      .split(/(?<=[.?!])\s+|\n+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }
  if (typeof value === "function") {
    const args = Array.from({ length: value.length }, () => "1");
    return collectSentences((value as (...a: string[]) => unknown)(...args));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectSentences);
  }
  return [];
};

describe("UI 문구 문체", () => {
  it.each(Object.entries(COPY_MODULES))("%s는 해요체로 쓴다", (_, copy) => {
    const formal = collectSentences(copy).filter((sentence) =>
      FORMAL_ENDING.test(sentence),
    );
    expect(formal).toEqual([]);
  });
});
