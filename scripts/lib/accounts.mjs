/**
 * 계정을 지우거나 바꾸는 운영 스크립트가 미리보기 첫머리에 대상 계정을 보여 주는 형식
 * (`getAccountIdentity`, `src/db/ops/deleteUser.ts`). 운영자는 이 줄을 본인 확인한 사람과 견준다.
 */

/** `<id> <이름> · <이메일> · <가입 시각> 가입`. 사용자 문서가 없으면 그렇다고 적는다 */
export function describeAccount(userId, account) {
  if (!account) return `${userId} (사용자 문서 없음)`;
  const joinedAt =
    account.createdAt instanceof Date
      ? account.createdAt.toISOString()
      : "알 수 없음";
  return `${userId} ${account.name} · ${account.email ?? "이메일 없음"} · ${joinedAt} 가입`;
}
