import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import {
  ExternalSearchLinks,
  getMelonSearchUrl,
  getBugsSearchUrl,
} from "./ExternalSearchLinks";

describe("ExternalSearchLinks (Task 3.3)", () => {
  describe("URL 빌더 유틸리티 함수", () => {
    it("getMelonSearchUrl은 곡 제목을 올바르게 인코딩한 멜론 검색 URL을 반환해야 한다", () => {
      const url = getMelonSearchUrl("은혜로다");
      expect(url).toBe(
        "https://www.melon.com/search/total/index.htm?q=%EC%9D%80%ED%98%9C%EB%A1%9C%EB%8B%A4",
      );
    });

    it("getBugsSearchUrl은 곡 제목을 올바르게 인코딩한 벅스 검색 URL을 반환해야 한다", () => {
      const url = getBugsSearchUrl("주 품에");
      expect(url).toBe(
        "https://music.bugs.co.kr/search/integrated?q=%EC%A3%BC%20%ED%92%88%EC%97%90",
      );
    });

    it("앞뒤 공백이 포함된 경우 공백을 trim하여 URL을 생성해야 한다", () => {
      const url = getMelonSearchUrl("  시선  ");
      expect(url).toBe(
        "https://www.melon.com/search/total/index.htm?q=%EC%8B%9C%EC%84%A0",
      );
    });
  });

  describe("ExternalSearchLinks 컴포넌트", () => {
    it("곡 제목이 있을 때 올바른 href, target, rel 속성을 가진 링크를 렌더링해야 한다", () => {
      render(<ExternalSearchLinks title="꽃들도" />);

      const melonLink = screen.getByRole("link", { name: /멜론/ });
      const bugsLink = screen.getByRole("link", { name: /벅스/ });

      expect(melonLink).toBeInTheDocument();
      expect(melonLink).toHaveAttribute("target", "_blank");
      expect(melonLink).toHaveAttribute("rel", "noopener noreferrer");
      expect(melonLink).toHaveAttribute(
        "href",
        getMelonSearchUrl("꽃들도"),
      );

      expect(bugsLink).toBeInTheDocument();
      expect(bugsLink).toHaveAttribute("target", "_blank");
      expect(bugsLink).toHaveAttribute("rel", "noopener noreferrer");
      expect(bugsLink).toHaveAttribute(
        "href",
        getBugsSearchUrl("꽃들도"),
      );
    });

    it("곡 제목이 비어있거나 공백일 때는 링크가 비활성화 상태(aria-disabled=true)여야 한다", () => {
      render(<ExternalSearchLinks title="   " />);

      const melonLink = screen.getByRole("link", { name: /멜론/ });
      const bugsLink = screen.getByRole("link", { name: /벅스/ });

      expect(melonLink).toHaveAttribute("aria-disabled", "true");
      expect(bugsLink).toHaveAttribute("aria-disabled", "true");
    });
  });
});
