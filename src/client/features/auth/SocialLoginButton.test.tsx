import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SocialLoginButton } from "./SocialLoginButton";

vi.mock("./brand/google-g.svg", () => ({
  default: { src: "/_next/static/media/google-g.svg", width: 20, height: 20 },
}));
vi.mock("./brand/kakao-symbol.svg", () => ({
  default: {
    src: "/_next/static/media/kakao-symbol.svg",
    width: 16,
    height: 13,
  },
}));
vi.mock("./brand/naver-logo.svg", () => ({
  default: { src: "/_next/static/media/naver-logo.svg", width: 16, height: 16 },
}));

describe("SocialLoginButton", () => {
  it.each([
    ["kakao", "/_next/static/media/kakao-symbol.svg"],
    ["naver", "/_next/static/media/naver-logo.svg"],
    ["google", "/_next/static/media/google-g.svg"],
  ] as const)(
    "%s 심볼은 Next가 돌려준 이미지 객체의 주소 문자열을 img src로 쓴다",
    (provider, url) => {
      render(<SocialLoginButton provider={provider} label="로그인" />);

      const mark = screen
        .getByRole("button", { name: "로그인" })
        .querySelector("img");

      expect(mark).toHaveAttribute("src", url);
    },
  );
});
