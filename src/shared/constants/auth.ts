/**
 * 비밀번호 길이 한도. Better Auth 설정(`minPasswordLength`/`maxPasswordLength`)과
 * 가입 폼·API 검증이 같은 값을 쓰게 한다. 상한은 해시 CPU 시간을 묶어 두는 역할도 한다.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
