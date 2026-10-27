import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  sanitizeFilename,
  worshipFileName,
} from "./songText.mjs";

describe("decodeHtmlEntities", () => {
  it("이름·10진·16진 엔티티를 글자로 바꾼다", () => {
    expect(decodeHtmlEntities("Love &amp; Grace")).toBe("Love & Grace");
    expect(
      decodeHtmlEntities("&lt;b&gt; &quot;주&quot; &#39;님&#39; &apos;!"),
    ).toBe(`<b> "주" '님' '!`);
    expect(decodeHtmlEntities("진리&#47504; 영이신")).toBe("진리릐 영이신");
    expect(decodeHtmlEntities("&#x1F600; &#X41;")).toBe("😀 A");
  });

  it("한 번만 풀어서 엔티티를 적은 글은 그 글로 남긴다", () => {
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeHtmlEntities("&amp;amp;")).toBe("&amp;");
  });

  it("줄 바꿈 없는 공백은 보통 공백으로 읽는다", () => {
    expect(decodeHtmlEntities("주&nbsp;은혜")).toBe("주 은혜");
  });

  it("엔티티가 아니거나 모르는 이름·범위 밖 코드는 그대로 둔다", () => {
    for (const text of [
      "AT&T",
      "& 그리고",
      "&unknown;",
      "&#xZZ;",
      "&#1114112;",
      "&#xD800;",
    ]) {
      expect(decodeHtmlEntities(text)).toBe(text);
    }
  });
});

describe("파일 이름", () => {
  it("파일 이름에 쓸 수 없는 글자는 _로 바꾼다", () => {
    expect(sanitizeFilename(' John 1:12 / 롬 6:23? "a" <b> |c| * ')).toBe(
      "John 1_12 _ 롬 6_23_ _a_ _b_ _c_ _",
    );
  });

  it("워십 곡 파일 이름은 [아티스트] 제목이고 아티스트가 없으면 Unknown이다", () => {
    expect(worshipFileName({ artist: "달빛마을", title: "John 1:12" })).toBe(
      "[달빛마을] John 1_12.txt",
    );
    expect(worshipFileName({ artist: "", title: "곡" })).toBe(
      "[Unknown] 곡.txt",
    );
  });
});
