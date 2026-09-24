import { describe, it, expect } from "vitest";
import { DeckSchema } from "@repo/shared";
import {
  createAuth,
  buildKakaoUser,
  buildNaverUser,
  hasCredentials,
  generateUserId,
  AUTH_BASE_PATH,
  SYNTHETIC_EMAIL_DOMAIN,
  type KakaoProfileLike,
  type NaverProfileLike,
} from "./auth";
import type { Bindings } from "../types";

/** 실제 제약을 그대로 쓴다 — 별도 정규식을 새로 쓰면 원천이 둘로 갈라진다 */
const UserIdSchema = DeckSchema.shape.userId;

function makeEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DB: {} as D1Database,
    MEDIA_BUCKET: {} as R2Bucket,
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
    BETTER_AUTH_URL: "http://localhost:5173",
    KAKAO_CLIENT_ID: "kakao-id",
    KAKAO_CLIENT_SECRET: "kakao-secret",
    NAVER_CLIENT_ID: "naver-id",
    NAVER_CLIENT_SECRET: "naver-secret",
    ...overrides,
  };
}

describe("worker auth 인스턴스", () => {
  it("basePath가 /api/auth다 (wrangler run_worker_first가 덮는 경로)", () => {
    expect(AUTH_BASE_PATH).toBe("/api/auth");
  });

  it("사용자 id를 21자 NanoID로 만든다 (@repo/shared의 IdSchema 통과)", () => {
    // Better Auth 기본 id는 32자 nanoid다. 그대로 두면 DeckSchema.userId가
    // 전부 실패하므로 공용 createId()(21자)를 강제해야 한다.
    for (let i = 0; i < 20; i++) {
      expect(UserIdSchema.safeParse(generateUserId()).success).toBe(true);
    }
  });

  it("자격증명이 있으면 프로바이더로 인정한다", () => {
    expect(hasCredentials("id", "secret")).toBe(true);
  });

  it("자격증명이 비었으면 프로바이더를 등록하지 않는다", () => {
    // 빈 문자열로 OAuth 프로바이더를 열어 두면 설정 실수가 런타임까지 숨는다.
    expect(hasCredentials(undefined, undefined)).toBe(false);
    expect(hasCredentials("", "secret")).toBe(false);
    expect(hasCredentials("id", "  ")).toBe(false);
  });

  describe("카카오 프로필 매핑", () => {
    it("이메일이 있으면 그대로 쓴다", () => {
      const profile: KakaoProfileLike = {
        id: 12345,
        kakao_account: {
          email: "worship@example.com",
          profile: {
            nickname: "찬양팀",
            profile_image_url: "https://img.example.com/a.png",
          },
        },
      };

      const user = buildKakaoUser(profile);
      expect(user.email).toBe("worship@example.com");
      expect(user.name).toBe("찬양팀");
      expect(user.image).toBe("https://img.example.com/a.png");
    });

    it("이메일이 없으면 합성 이메일로 폴백한다", () => {
      // account_email은 비즈 앱 심사를 통과해야 내려온다. 이메일이 없다고
      // 가입이 실패하면 카카오 로그인 자체가 막힌다.
      const profile: KakaoProfileLike = {
        id: 98765,
        kakao_account: { profile: { nickname: "봉사자" } },
      };

      const user = buildKakaoUser(profile);
      expect(user.email).toBe(`kakao_98765@${SYNTHETIC_EMAIL_DOMAIN}`);
      expect(user.emailVerified).toBe(false);
      expect(user.name).toBe("봉사자");
    });

    it("닉네임조차 없으면 빈 이름 대신 대체 표시명을 쓴다", () => {
      const user = buildKakaoUser({ id: 42 });
      expect(user.name.length).toBeGreaterThan(0);
      expect(user.email).toBe(`kakao_42@${SYNTHETIC_EMAIL_DOMAIN}`);
    });
  });

  describe("네이버 프로필 매핑", () => {
    it("이메일이 있으면 그대로 쓴다", () => {
      const profile: NaverProfileLike = {
        response: {
          id: "naver-abc",
          email: "singer@example.com",
          nickname: "인도자",
          profile_image: "https://img.example.com/b.png",
        },
      };

      const user = buildNaverUser(profile);
      expect(user.email).toBe("singer@example.com");
      expect(user.name).toBe("인도자");
      expect(user.image).toBe("https://img.example.com/b.png");
    });

    it("이메일이 없으면 합성 이메일로 폴백한다", () => {
      const user = buildNaverUser({ response: { id: "naver-xyz" } });
      expect(user.email).toBe(`naver_naver-xyz@${SYNTHETIC_EMAIL_DOMAIN}`);
      expect(user.emailVerified).toBe(false);
    });
  });

  describe("createAuth", () => {
    it("핸들러를 가진 인스턴스를 만든다", () => {
      const auth = createAuth(makeEnv());
      expect(typeof auth.handler).toBe("function");
      expect(auth.api).toBeDefined();
    });

    it("같은 env로 두 번 부르면 인스턴스를 재사용한다", () => {
      const env = makeEnv();
      expect(createAuth(env)).toBe(createAuth(env));
    });

    it("자격증명이 없어도 인스턴스 생성 자체는 실패하지 않는다", () => {
      // 로그인은 불가능하되 서버가 부팅은 되어야 한다. 배경 영상 같은
      // 비인증 라우트까지 같이 죽으면 안 된다.
      const auth = createAuth(
        makeEnv({
          KAKAO_CLIENT_ID: undefined,
          KAKAO_CLIENT_SECRET: undefined,
          NAVER_CLIENT_ID: undefined,
          NAVER_CLIENT_SECRET: undefined,
        }),
      );
      expect(typeof auth.handler).toBe("function");
    });
  });
});
