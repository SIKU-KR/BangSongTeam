import { isReservedDocumentId } from "#shared";
import { runBulk, type Db } from "../client";
import { presentationMembersCol, presentationsCol } from "../collections";

/**
 * 공유 링크 운영 작업. 관리자 화면 없이 `scripts/moderation.mjs`로 실행한다.
 *
 * 운영자가 붙여 넣은 값이 문서 id가 될 수 없으면(빈 값, `/`가 든 주소, `.`·`..`, `__…__`) SDK가
 * 던지거나 서버가 거절하므로, 그런 값은 문서를 읽기 전에 "없는 id"로 다룬다.
 */

function isDocumentId(id: string): boolean {
  return (
    id !== "" &&
    id !== "." &&
    id !== ".." &&
    !id.includes("/") &&
    !isReservedDocumentId(id)
  );
}

/**
 * 공유 링크 토큰으로 프레젠테이션 id를 찾는다. 링크가 꺼진 프레젠테이션도 토큰을 남기므로
 * 찾는다. 신고가 `/s/<토큰>` 주소로만 들어올 때 운영자가 id를 알아내는 길이다.
 */
export async function findPresentationIdByLinkToken(
  db: Db,
  token: string,
): Promise<string | null> {
  const snapshot = await presentationsCol(db)
    .where("linkToken", "==", token)
    .limit(1)
    .get();
  return snapshot.docs[0]?.id ?? null;
}

/**
 * 공유 링크를 운영자가 막는다. 링크를 끄고 토큰을 비운 뒤 링크로 들어온 멤버를 모두 지운다.
 * 로그인 없이 읽는 `GET /api/share/:token`은 토큰만 보므로 퍼진 주소는 바로 죽고, 멤버를
 * 지워 둬서 소유자가 다시 공유해도(새 토큰이 만들어진다) 예전 멤버가 접근을 되찾지 못한다.
 * 퍼진 링크는 멤버가 한 번에 쓸 수 있는 문서 수를 넘을 수 있어, 접근부터 끊은 다음 멤버를
 * 나눠 지운다. 중간에 멈추면 토큰이 이미 지워져 링크 주소로는 찾을 수 없으니 같은
 * 프레젠테이션 id로 다시 실행한다. 프레젠테이션이 없으면(문서 id가 될 수 없는 값 포함) false다.
 */
export async function disableShareLink(
  db: Db,
  presentationId: string,
): Promise<boolean> {
  if (!isDocumentId(presentationId)) return false;
  const ref = presentationsCol(db).doc(presentationId);
  const disabled = await db.runTransaction(async (tx) => {
    if (!(await tx.get(ref)).exists) return false;
    tx.update(ref, { linkAccess: "off", linkToken: null });
    return true;
  });
  if (!disabled) return false;

  const members = await presentationMembersCol(db)
    .where("presentationId", "==", presentationId)
    .get();
  await runBulk(db, (writer) =>
    members.docs.map((member) => writer.delete(member.ref)),
  );
  return true;
}
