import { describe, it, expect } from "vitest";
import { hashPassword as hashScryptPassword } from "better-auth/crypto";
import { hashPassword, verifyPassword, PBKDF2_ITERATIONS } from "./password";

describe("PBKDF2 비밀번호 해시", () => {
  it("반복 횟수·솔트·키를 담은 형식으로 저장한다", async () => {
    const hash = await hashPassword("correct horse battery");

    expect(hash).toMatch(
      new RegExp(
        `^pbkdf2-sha256\\$${PBKDF2_ITERATIONS}\\$[0-9a-f]{32}\\$[0-9a-f]{64}$`,
      ),
    );
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
    expect(await verifyPassword({ hash, password: "wrong password" })).toBe(
      false,
    );
  });

  it("유니코드 정규화(NFKC)가 같은 비밀번호는 같게 본다", async () => {
    const hash = await hashPassword("찬양팀비밀번호");

    expect(
      await verifyPassword({
        hash,
        password: "찬양팀비밀번호".normalize("NFD"),
      }),
    ).toBe(true);
  });

  it("저장된 반복 횟수로 검증한다", async () => {
    const hash = await hashPassword("legacy-iterations", 1000);

    expect(hash.split("$")[1]).toBe("1000");
    expect(await verifyPassword({ hash, password: "legacy-iterations" })).toBe(
      true,
    );
  });

  it("이전 Better Auth scrypt 해시도 검증한다", async () => {
    const hash = await hashScryptPassword("dev-account-password");

    expect(
      await verifyPassword({ hash, password: "dev-account-password" }),
    ).toBe(true);
    expect(await verifyPassword({ hash, password: "other" })).toBe(false);
  });

  it("깨진 해시는 예외 대신 불일치다", async () => {
    for (const hash of [
      "",
      "pbkdf2-sha256$x$",
      "pbkdf2-sha256$1000$zz$00",
      "pbkdf2-sha256$0$00$00",
      "no-colon-here",
    ]) {
      expect(await verifyPassword({ hash, password: "anything" })).toBe(false);
    }
  });
});
