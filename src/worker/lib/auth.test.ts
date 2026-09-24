import { describe, it, expect } from "vitest";
import { DeckSchema } from "#shared";
import {
  createAuth,
  buildKakaoUser,
  buildNaverUser,
  hasCredentials,
  generateUserId,
  isAdminUser,
  AUTH_BASE_PATH,
  SYNTHETIC_EMAIL_DOMAIN,
  type KakaoProfileLike,
  type NaverProfileLike,
} from "./auth";
import type { Bindings } from "../types";

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

  it("사용자 id를 21자 NanoID로 만든다 (#shared의 IdSchema 통과)", () => {
    for (let i = 0; i < 20; i++) {
      expect(UserIdSchema.safeParse(generateUserId()).success).toBe(true);
    }
  });

  it("자격증명이 있으면 프로바이더로 인정한다", () => {
    expect(hasCredentials("id", "secret")).toBe(true);
  });

  it("자격증명이 비었으면 프로바이더를 등록하지 않는다", () => {
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

  describe("isAdminUser", () => {
    it("ADMIN_USER_IDS에 적힌 user id만 관리자로 본다", () => {
      const env = makeEnv({ ADMIN_USER_IDS: " admin-1, admin-2\nadmin-3 " });
      expect(isAdminUser(env, "admin-1")).toBe(true);
      expect(isAdminUser(env, "admin-3")).toBe(true);
      expect(isAdminUser(env, "admin")).toBe(false);
      expect(isAdminUser(env, undefined)).toBe(false);
    });

    it("목록이 비어 있으면 관리자가 없다", () => {
      expect(isAdminUser(makeEnv(), "admin-1")).toBe(false);
      expect(isAdminUser(makeEnv({ ADMIN_USER_IDS: " , " }), "")).toBe(false);
    });
  });
});
