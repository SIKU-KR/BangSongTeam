import { describe, expect, it } from "vitest";
import { hash as argon2Hash } from "@node-rs/argon2";
import { hashPassword, verifyPassword } from "./password";

describe("Argon2id 비밀번호 해시", () => {
  it("OWASP 매개변수를 담은 PHC 문자열로 저장한다", async () => {
    const hash = await hashPassword("correct horse battery");

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("같은 비밀번호도 솔트가 달라 해시가 매번 다르다", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same-password"),
      hashPassword("same-password"),
    ]);

    expect(a).not.toBe(b);
  });

  it("맞는 비밀번호만 통과한다", async () => {
    const hash = await hashPassword("correct horse battery");

    expect(
      await verifyPassword({ hash, password: "correct horse battery" }),
    ).toBe(true);
    expect(
      await verifyPassword({ hash, password: "wrong horse battery" }),
    ).toBe(false);
  });

  it("깨진 해시나 Argon2id가 아닌 해시는 예외 없이 거절한다", async () => {
    const argon2i = await argon2Hash("password-1234", {
      algorithm: 1,
    });

    expect(await verifyPassword({ hash: "", password: "x" })).toBe(false);
    expect(
      await verifyPassword({ hash: "$argon2id$garbage", password: "x" }),
    ).toBe(false);
    expect(
      await verifyPassword({ hash: argon2i, password: "password-1234" }),
    ).toBe(false);
  });
});
