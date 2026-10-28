import { describe, it, expect } from "vitest";
import { SOCIAL_PROVIDERS, visibleSocialProviders } from "./authClient";

function visibleIds(
  configured: Parameters<typeof visibleSocialProviders>[0],
): string[] {
  return visibleSocialProviders(configured).map((provider) => provider.id);
}

describe("visibleSocialProviders", () => {
  it("서버가 켜 둔 로그인만 로그인 화면 순서대로 보인다", () => {
    expect(visibleIds(["google", "kakao", "naver"])).toEqual([
      "kakao",
      "naver",
      "google",
    ]);
    expect(visibleIds(["naver", "google"])).toEqual(["naver", "google"]);
    expect(visibleIds(["google"])).toEqual(["google"]);
  });

  it("서버가 아무 로그인도 켜 두지 않았으면 소셜 로그인은 보이지 않는다", () => {
    expect(visibleIds([])).toEqual([]);
  });

  it("서버가 켜 둔 목록을 아직 모르면 꺼 둔 적 없는 Google만 보인다", () => {
    expect(visibleIds(undefined)).toEqual(["google"]);
  });

  it("버튼에는 로그인 화면이 정한 레이블을 그대로 쓴다", () => {
    expect(visibleSocialProviders(["kakao"])).toEqual(
      SOCIAL_PROVIDERS.filter((provider) => provider.id === "kakao"),
    );
  });
});
