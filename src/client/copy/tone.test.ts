import { describe, expect, it } from "vitest";
import { API_ERRORS } from "#shared";
import { AUTH_COPY, LEGAL_COPY } from "./auth";
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
  LEGAL_COPY,
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

const FORMAL_ENDING = /(니다|니까|십시오|하세요)[.?!]?$/;

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
  it.each([
    "저장합니다.",
    "모바일 사이드바입니다.",
    "삭제됩니다.",
    "삭제하시겠습니까?",
  ])("합니다체 '%s'를 잡는다", (sentence) => {
    expect(FORMAL_ENDING.test(sentence)).toBe(true);
  });

  it.each([
    "저장했어요.",
    "모바일 사이드바예요.",
    "삭제할까요?",
    "다시 시도해 주세요",
  ])("해요체 '%s'는 잡지 않는다", (sentence) => {
    expect(FORMAL_ENDING.test(sentence)).toBe(false);
  });

  it.each(Object.entries(COPY_MODULES))("%s는 해요체로 쓴다", (_, copy) => {
    const formal = collectSentences(copy).filter((sentence) =>
      FORMAL_ENDING.test(sentence),
    );
    expect(formal).toEqual([]);
  });
});
