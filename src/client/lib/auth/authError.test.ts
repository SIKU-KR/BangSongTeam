import { describe, it, expect } from "vitest";
import { AUTH_COPY } from "#copy/auth";
import { callbackErrorMessage, withoutAuthError } from "./authError";

describe("callbackErrorMessage", () => {
  it.each([null, ""])("오류 코드가 %j이면 안내도 없다", (code) => {
    expect(callbackErrorMessage(code)).toBeNull();
  });

  it("소셜 로그인 화면에서 직접 취소했으면 안내하지 않는다", () => {
    expect(callbackErrorMessage("access_denied")).toBeNull();
  });

  it("같은 이메일로 다른 방법으로 가입한 계정이 있으면 가입한 방법으로 로그인하라고 알린다", () => {
    expect(callbackErrorMessage("account_not_linked")).toBe(
      AUTH_COPY.oauthErrors.accountNotLinked,
    );
  });

  it("로그인 도중 상태가 사라졌으면 시간이 지났다고 알린다", () => {
    expect(callbackErrorMessage("state_mismatch")).toBe(
      AUTH_COPY.oauthErrors.stateExpired,
    );
  });

  it.each(["unable_to_get_user_info", "email_not_found", "internal_error"])(
    "그 밖의 오류 %j는 로그인을 마치지 못했다고 알린다",
    (code) => {
      expect(callbackErrorMessage(code)).toBe(AUTH_COPY.signInFailed);
    },
  );
});

describe("withoutAuthError", () => {
  it.each([
    ["?error=access_denied", ""],
    ["?error=account_not_linked&error_description=x", ""],
    ["?copy=1&error=state_mismatch", "?copy=1"],
    ["?error=state_mismatch&copy=1", "?copy=1"],
    ["?copy=1", "?copy=1"],
    ["", ""],
  ])("%j에서 오류 코드만 지운다", (search, expected) => {
    expect(withoutAuthError(search)).toBe(expected);
  });
});
