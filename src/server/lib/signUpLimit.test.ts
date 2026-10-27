import { describe, it, expect } from "vitest";
import { signUpQuotaKey } from "./signUpLimit";

describe("signUpQuotaKey", () => {
  it("IPv6는 /64 대역마다, IPv4를 담은 IPv6는 IPv4로 같은 키를 쓴다", () => {
    expect(signUpQuotaKey("2001:db8:1:2::1", "s")).toBe(
      signUpQuotaKey("2001:db8:1:2:ffff::9", "s"),
    );
    expect(signUpQuotaKey("2001:db8:1:2::1", "s")).not.toBe(
      signUpQuotaKey("2001:db8:1:3::1", "s"),
    );
    expect(signUpQuotaKey("::ffff:192.0.2.1", "s")).toBe(
      signUpQuotaKey("192.0.2.1", "s"),
    );
  });

  it("IP를 드러내지 않고 비밀값이 다르면 다른 키다", () => {
    const key = signUpQuotaKey("192.0.2.1", "s");

    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(signUpQuotaKey("192.0.2.1", "t")).not.toBe(key);
  });
});
