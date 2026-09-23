import { describe, it, expect } from "vitest";
import {
  buildNormalizationMessages,
  extractModelText,
  isPlausiblyComplete,
  normalizeLyricsText,
  pickPopularRoot,
  suggestMaxTokens,
} from "./normalization";
import { verifyNormalization } from "./verifyNormalization";

describe("normalizeLyricsText", () => {
  it("trims lines and collapses blank lines between verses", () => {
    expect(
      normalizeLyricsText("\n\n  첫 줄 \n둘째 줄\n\n\n\n　셋째 줄\n\n"),
    ).toBe("첫 줄\n둘째 줄\n\n셋째 줄");
  });
});

describe("pickPopularRoot", () => {
  it("picks the lyrics registered by the most users, ignoring whitespace", () => {
    expect(
      pickPopularRoot([
        { lyrics: "소수 버전", createdAt: "2026-09-01T00:00:00Z" },
        { lyrics: "다수  버전\n\n둘째", createdAt: "2026-09-03T00:00:00Z" },
        { lyrics: "다수 버전\n둘째", createdAt: "2026-09-02T00:00:00Z" },
      ]),
    ).toBe("다수 버전\n둘째");
  });

  it("breaks ties by the earliest registration", () => {
    expect(
      pickPopularRoot([
        { lyrics: "나중", createdAt: "2026-09-05T00:00:00Z" },
        { lyrics: "먼저", createdAt: "2026-09-01T00:00:00Z" },
      ]),
    ).toBe("먼저");
  });

  it("is deterministic when whitespace variants were registered at the same time", () => {
    const at = "2026-09-01T00:00:00Z";
    const a = { lyrics: "주의 은혜아래", createdAt: at };
    const b = { lyrics: "주의 은혜 아래", createdAt: at };
    expect(pickPopularRoot([a, b])).toBe(pickPopularRoot([b, a]));
  });

  it("returns null without versions", () => {
    expect(pickPopularRoot([])).toBeNull();
  });
});

describe("buildNormalizationMessages", () => {
  it("sends the fixed system prompt and every version with clear boundaries", () => {
    const [system, user] = buildNormalizationMessages(["가사 A", "가사 B"]);
    expect(system.role).toBe("system");
    expect(system.content).toContain("DO NOT invent");
    expect(user.content).toContain("### Version 1\n가사 A");
    expect(user.content).toContain("### Version 2\n가사 B");
  });
});

describe("extractModelText", () => {
  it("strips leaked think blocks and code fences", () => {
    expect(
      extractModelText(
        "<think>다수결을 따지면…</think>\n```\n첫 줄\n\n\n둘째\n```",
      ),
    ).toBe("첫 줄\n\n둘째");
  });

  it("drops an unterminated think block", () => {
    expect(extractModelText("<think>생각이 잘렸")).toBe("");
  });

  it("keeps plain lyrics as they are", () => {
    expect(extractModelText("첫 줄\n둘째 줄")).toBe("첫 줄\n둘째 줄");
  });
});

describe("isPlausiblyComplete", () => {
  const full = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10";

  it("rejects an output that silently drops most of the song", () => {
    // verifyNormalization은 통과한다 — 모든 줄이 입력에 있다
    expect(verifyNormalization("1\n2", [full, full])).toBe(true);
    expect(isPlausiblyComplete("1\n2", [full, full])).toBe(false);
  });

  it("allows dropping a minority-only line", () => {
    expect(isPlausiblyComplete("1\n2\n3\n4\n5\n6\n7\n8\n9", [full, full])).toBe(
      true,
    );
  });
});

describe("suggestMaxTokens", () => {
  it("scales with the longest version within bounds", () => {
    expect(suggestMaxTokens(["짧음"])).toBe(512);
    expect(suggestMaxTokens(["가".repeat(1000)])).toBe(1756);
    expect(suggestMaxTokens(["가".repeat(10000)])).toBe(4096);
  });
});
