import { hash, verify } from "@node-rs/argon2";

/**
 * OWASP 권장 Argon2id 매개변수(메모리 19 MiB, 2회 반복, 병렬 1).
 *
 * 매개변수는 PHC 문자열에 함께 저장되므로 값을 올려도 이미 저장된 해시는 그대로
 * 검증된다. 알고리즘은 라이브러리 기본값(Argon2id)에 맡긴다.
 */
export const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** 비밀번호를 솔트가 든 Argon2id PHC 문자열로 바꾼다 */
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * 저장된 PHC 문자열과 비밀번호를 비교한다.
 *
 * 형식이 깨졌거나 Argon2id가 아닌 해시는 예외 대신 false를 돌려준다. 해시 형식 문제가
 * 로그인 요청의 5xx로 번지지 않게 하기 위해서다.
 */
export async function verifyPassword(data: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (!data.hash.startsWith("$argon2id$")) return false;
  try {
    return await verify(data.hash, data.password);
  } catch {
    return false;
  }
}
