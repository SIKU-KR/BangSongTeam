import type { DocumentSnapshot } from "@google-cloud/firestore";
import {
  createId,
  toDisplayName,
  type LinkAccess,
  type PresentationDocument,
  type ShareSettings,
} from "#shared";
import type { Db } from "../client";
import {
  memberDocId,
  presentationMembersCol,
  presentationsCol,
  usersCol,
  type PresentationDoc,
} from "../collections";
import {
  byServiceDateDesc,
  hydratePresentationDocuments,
} from "./presentations";

export type PresentationRole = "owner" | "viewer";

/** 링크 공유가 살아 있는 세트인지. 휴지통에 들어간 세트는 링크가 멈춘다 */
function isLinkActive(presentation: PresentationDoc): boolean {
  return presentation.linkAccess !== "off" && presentation.trashedAt === null;
}

/**
 * 세트 접근 권한을 한 곳에서 판정한다.
 *
 * 소유자가 아니면 멤버 문서가 있고 링크가 살아 있을 때만 보기 권한을 준다.
 * 소유자가 링크를 끄거나 세트를 휴지통에 넣으면 다음 요청부터 막힌다.
 */
export async function resolvePresentationAccess(
  db: Db,
  presentationId: string,
  userId: string,
): Promise<PresentationRole | null> {
  const [presentationSnapshot, memberSnapshot] = await Promise.all([
    presentationsCol(db).doc(presentationId).get(),
    presentationMembersCol(db).doc(memberDocId(presentationId, userId)).get(),
  ]);
  const presentation = presentationSnapshot.data();
  if (!presentation) return null;
  if (presentation.userId === userId) return "owner";
  if (!memberSnapshot.exists || !isLinkActive(presentation)) return null;
  return "viewer";
}

async function ownerNames(
  db: Db,
  presentations: PresentationDoc[],
): Promise<Map<string, string>> {
  const ids = [...new Set(presentations.map((p) => p.userId))];
  if (ids.length === 0) return new Map();
  const users = await db.getAll(...ids.map((id) => usersCol(db).doc(id)));
  return new Map(
    users.flatMap((snapshot) => {
      const user = snapshot.data();
      return user ? [[snapshot.id, toDisplayName(user.name)] as const] : [];
    }),
  );
}

/** 소유자면 문서 그대로, 공유받은 사람이면 `access`를 붙여 돌려준다. */
export async function getPresentationDocument(
  db: Db,
  presentationId: string,
  userId: string,
): Promise<PresentationDocument | null> {
  const role = await resolvePresentationAccess(db, presentationId, userId);
  if (!role) return null;

  const header = (await presentationsCol(db).doc(presentationId).get()).data();
  if (!header) return null;
  const ownerName = (await ownerNames(db, [header])).get(header.userId);
  if (ownerName === undefined) return null;

  const [document] = await hydratePresentationDocuments(db, [header]);
  if (!document) return null;
  return role === "owner"
    ? document
    : toSharedDocument(document, ownerName, userId);
}

/**
 * 공유받은 사람에게 주는 모양. 폴더·휴지통은 소유자의 드라이브 배치라 비운다.
 * `memberId`가 없으면 로그인하지 않고 링크로 보는 사람이다.
 */
function toSharedDocument(
  document: PresentationDocument,
  ownerName: string,
  memberId?: string,
): PresentationDocument {
  return {
    ...document,
    folderId: null,
    trashedAt: null,
    access: memberId ? { ownerName, memberId } : { ownerName },
  };
}

async function findActiveByToken(
  db: Db,
  token: string,
): Promise<PresentationDoc | null> {
  const snapshot = await presentationsCol(db)
    .where("linkToken", "==", token)
    .limit(1)
    .get();
  const presentation = snapshot.docs[0]?.data();
  return presentation && isLinkActive(presentation) ? presentation : null;
}

/**
 * 로그인 없이 링크로 보는 세트. 멤버로 기록하지 않으므로 드라이브·목록 조회에는
 * 이어지지 않고, 링크가 살아 있는 동안 토큰을 아는 사람에게만 문서를 준다.
 */
export async function getSharedDocumentByToken(
  db: Db,
  token: string,
): Promise<PresentationDocument | null> {
  const header = await findActiveByToken(db, token);
  if (!header) return null;
  const ownerName = (await ownerNames(db, [header])).get(header.userId);
  if (ownerName === undefined) return null;

  const [document] = await hydratePresentationDocuments(db, [header]);
  return document ? toSharedDocument(document, ownerName) : null;
}

/**
 * 링크로 들어와 아직 접근할 수 있는 세트 목록.
 * 폴더·휴지통은 소유자의 드라이브 배치라 공유받은 사람에게는 비워서 준다.
 */
export async function getSharedPresentationDocuments(
  db: Db,
  userId: string,
): Promise<PresentationDocument[]> {
  const memberships = await presentationMembersCol(db)
    .where("userId", "==", userId)
    .get();
  if (memberships.empty) return [];

  const presentations = (await db.getAll(
    ...memberships.docs.map((doc) =>
      presentationsCol(db).doc(doc.data().presentationId),
    ),
  )) as DocumentSnapshot<PresentationDoc>[];
  const visible = presentations
    .flatMap((snapshot) => {
      const presentation = snapshot.data();
      return presentation ? [presentation] : [];
    })
    .filter((p) => p.userId !== userId && isLinkActive(p));
  const names = await ownerNames(db, visible);
  const headers = visible
    .filter((p) => names.has(p.userId))
    .sort(byServiceDateDesc);

  const documents = await hydratePresentationDocuments(db, headers);
  return documents.map((document, index) =>
    toSharedDocument(
      document,
      names.get(headers[index]?.userId ?? "") ?? "",
      userId,
    ),
  );
}

/** 소유자만 볼 수 있다. 소유자가 아니면 null. */
export async function getShareSettings(
  db: Db,
  presentationId: string,
  ownerId: string,
): Promise<ShareSettings | null> {
  const presentation = (
    await presentationsCol(db).doc(presentationId).get()
  ).data();
  if (presentation?.userId !== ownerId) return null;
  return { access: presentation.linkAccess, token: presentation.linkToken };
}

/** 링크를 처음 켤 때 토큰을 만든다. 끄더라도 토큰과 멤버는 남겨 다시 켜면 이어진다. */
export async function setLinkAccess(
  db: Db,
  presentationId: string,
  ownerId: string,
  access: LinkAccess,
): Promise<ShareSettings | null> {
  return db.runTransaction(async (tx) => {
    const ref = presentationsCol(db).doc(presentationId);
    const presentation = (await tx.get(ref)).data();
    if (presentation?.userId !== ownerId) return null;

    const token =
      presentation.linkToken ?? (access === "off" ? null : createId());
    tx.update(ref, { linkAccess: access, linkToken: token });
    return { access, token };
  });
}

/**
 * 링크 재설정. 토큰을 새로 만들고 기존 멤버를 모두 지워, 예전 링크로
 * 들어온 사람의 접근을 끊는다.
 */
export async function resetLinkToken(
  db: Db,
  presentationId: string,
  ownerId: string,
): Promise<ShareSettings | null> {
  return db.runTransaction(async (tx) => {
    const ref = presentationsCol(db).doc(presentationId);
    const [presentationSnapshot, members] = await Promise.all([
      tx.get(ref),
      tx.get(
        presentationMembersCol(db).where(
          "presentationId",
          "==",
          presentationId,
        ),
      ),
    ]);
    const presentation = presentationSnapshot.data();
    if (presentation?.userId !== ownerId) return null;

    const token = createId();
    tx.update(ref, { linkToken: token });
    for (const member of members.docs) tx.delete(member.ref);
    return { access: presentation.linkAccess, token };
  });
}

export interface JoinResult {
  presentationId: string;
  role: PresentationRole;
  document: PresentationDocument;
}

/** 링크가 살아 있으면 멤버로 기록하고 문서를 돌려준다. 소유자는 기록하지 않는다. */
export async function joinByToken(
  db: Db,
  token: string,
  userId: string,
): Promise<JoinResult | null> {
  const target = await findActiveByToken(db, token);
  if (!target) return null;

  if (target.userId !== userId) {
    await presentationMembersCol(db)
      .doc(memberDocId(target.id, userId))
      .set({ presentationId: target.id, userId });
  }

  const role = await resolvePresentationAccess(db, target.id, userId);
  const document = await getPresentationDocument(db, target.id, userId);
  if (!role || !document) return null;
  return { presentationId: target.id, role, document };
}
