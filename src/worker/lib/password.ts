import {
  constantTimeEqual,
  verifyPassword as verifyScryptPassword,
} from "better-auth/crypto";

const PBKDF2_PREFIX = "pbkdf2-sha256";
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/**
 * PBKDF2 반복 횟수. Workers Web Crypto가 허용하는 상한이다.
 *
 * Better Auth 기본 해시(scrypt N=16384, r=16)는 workerd 네이티브 구현으로도 1회에
 * CPU 40ms 넘게 써서 Workers Free의 요청당 CPU 10ms 한도에 걸린다(오류 1102).
 * 이 값은 저장된 해시에 함께 기록되므로 바꿔도 기존 비밀번호는 계속 검증된다.
 */
export const PBKDF2_ITERATIONS = 100_000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** `pbkdf2-sha256$<iterations>$<salt hex>$<key hex>` 형식으로 저장한다. */
export async function hashPassword(
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(password, salt, iterations);
  return [PBKDF2_PREFIX, iterations, toHex(salt), toHex(key)].join("$");
}

/**
 * 저장된 해시와 비밀번호를 대조한다. 형식이 깨진 값은 예외 대신 불일치로 본다.
 *
 * 접두사가 없는 값은 이 해셔 이전의 Better Auth scrypt 해시(`salt:key`)다.
 * 로컬 D1에 개발자 로그인으로 만든 계정이 남아 있어 그쪽으로 넘겨 검증한다.
 */
export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (!hash.startsWith(`${PBKDF2_PREFIX}$`)) {
    return await verifyScryptPassword({ hash, password }).catch(() => false);
  }

  const [, rawIterations, saltHex, keyHex] = hash.split("$");
  const iterations = Number(rawIterations);
  const salt = fromHex(saltHex ?? "");
  const expected = fromHex(keyHex ?? "");
  if (
    !Number.isSafeInteger(iterations) ||
    iterations <= 0 ||
    !salt ||
    !expected
  ) {
    return false;
  }

  const actual = await deriveKey(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}
