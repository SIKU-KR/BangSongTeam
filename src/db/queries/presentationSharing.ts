import { and, desc, eq, isNull, ne } from "drizzle-orm";
import {
  createId,
  type LinkAccess,
  type PresentationDocument,
  type ShareSettings,
} from "#shared";
import { presentations, presentationMembers, user } from "../schema";
import { hydratePresentationDocuments } from "./presentations";
import { runStatements } from "./batch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

export type PresentationRole = "owner" | "viewer";

/**
 * 링크 공유가 살아 있는 세트만 고르는 조건.
 * 휴지통에 들어간 세트는 링크가 멈춘다.
 */
function linkActiveCondition() {
  return and(
    ne(presentations.linkAccess, "off"),
    isNull(presentations.trashedAt),
  );
}

/**
 * 세트 접근 권한을 한 곳에서 판정한다.
 *
 * 소유자가 아니면 멤버 행이 있고 링크가 살아 있을 때만 보기 권한을 준다.
 * 소유자가 링크를 끄거나 세트를 휴지통에 넣으면 다음 요청부터 막힌다.
 */
export async function resolvePresentationAccess(
  db: DbInstance,
  presentationId: string,
  userId: string,
): Promise<PresentationRole | null> {
  const [row] = await db
    .select({
      ownerId: presentations.userId,
      linkAccess: presentations.linkAccess,
      trashedAt: presentations.trashedAt,
      memberId: presentationMembers.userId,
    })
    .from(presentations)
    .leftJoin(
      presentationMembers,
      and(
        eq(presentationMembers.presentationId, presentations.id),
        eq(presentationMembers.userId, userId),
      ),
    )
    .where(eq(presentations.id, presentationId));

  if (!row) return null;
  if (row.ownerId === userId) return "owner";
  if (!row.memberId || row.trashedAt || row.linkAccess === "off") return null;
  return "viewer";
}

/** 소유자면 문서 그대로, 공유받은 사람이면 `access`를 붙여 돌려준다. */
export async function getPresentationDocument(
  db: DbInstance,
  presentationId: string,
  userId: string,
): Promise<PresentationDocument | null> {
  const role = await resolvePresentationAccess(db, presentationId, userId);
  if (!role) return null;

  const [header] = await db
    .select({ presentation: presentations, ownerName: user.name })
    .from(presentations)
    .innerJoin(user, eq(user.id, presentations.userId))
    .where(eq(presentations.id, presentationId));
  if (!header) return null;

  const [document] = await hydratePresentationDocuments(db, [
    header.presentation,
  ]);
  if (!document) return null;
  return role === "owner"
    ? document
    : toSharedDocument(document, header.ownerName, userId);
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

/**
 * 로그인 없이 링크로 보는 세트. 멤버로 기록하지 않으므로 드라이브·목록 조회에는
 * 이어지지 않고, 링크가 살아 있는 동안 토큰을 아는 사람에게만 문서를 준다.
 */
export async function getSharedDocumentByToken(
  db: DbInstance,
  token: string,
): Promise<PresentationDocument | null> {
  const [header] = await db
    .select({ presentation: presentations, ownerName: user.name })
    .from(presentations)
    .innerJoin(user, eq(user.id, presentations.userId))
    .where(and(eq(presentations.linkToken, token), linkActiveCondition()));
  if (!header) return null;

  const [document] = await hydratePresentationDocuments(db, [
    header.presentation,
  ]);
  return document ? toSharedDocument(document, header.ownerName) : null;
}

/**
 * 링크로 들어와 아직 접근할 수 있는 세트 목록.
 * 폴더·휴지통은 소유자의 드라이브 배치라 공유받은 사람에게는 비워서 준다.
 */
export async function getSharedPresentationDocuments(
  db: DbInstance,
  userId: string,
): Promise<PresentationDocument[]> {
  const headers: Array<{
    presentation: typeof presentations.$inferSelect;
    ownerName: string;
  }> = await db
    .select({ presentation: presentations, ownerName: user.name })
    .from(presentationMembers)
    .innerJoin(
      presentations,
      eq(presentations.id, presentationMembers.presentationId),
    )
    .innerJoin(user, eq(user.id, presentations.userId))
    .where(
      and(
        eq(presentationMembers.userId, userId),
        ne(presentations.userId, userId),
        linkActiveCondition(),
      ),
    )
    .orderBy(desc(presentations.serviceDate), desc(presentations.createdAt));

  const documents = await hydratePresentationDocuments(
    db,
    headers.map((h) => h.presentation),
  );

  return documents.map((document, index) =>
    toSharedDocument(document, headers[index]?.ownerName ?? "", userId),
  );
}

/** 소유자만 볼 수 있다. 소유자가 아니면 null. */
export async function getShareSettings(
  db: DbInstance,
  presentationId: string,
  ownerId: string,
): Promise<ShareSettings | null> {
  const [row] = await db
    .select({
      access: presentations.linkAccess,
      token: presentations.linkToken,
    })
    .from(presentations)
    .where(
      and(
        eq(presentations.id, presentationId),
        eq(presentations.userId, ownerId),
      ),
    );
  return row ?? null;
}

/** 링크를 처음 켤 때 토큰을 만든다. 끄더라도 토큰과 멤버는 남겨 다시 켜면 이어진다. */
export async function setLinkAccess(
  db: DbInstance,
  presentationId: string,
  ownerId: string,
  access: LinkAccess,
): Promise<ShareSettings | null> {
  const current = await getShareSettings(db, presentationId, ownerId);
  if (!current) return null;

  const token = current.token ?? (access === "off" ? null : createId());
  await db
    .update(presentations)
    .set({ linkAccess: access, linkToken: token })
    .where(eq(presentations.id, presentationId));
  return { access, token };
}

/**
 * 링크 재설정. 토큰을 새로 만들고 기존 멤버를 모두 지워, 예전 링크로
 * 들어온 사람의 접근을 끊는다.
 */
export async function resetLinkToken(
  db: DbInstance,
  presentationId: string,
  ownerId: string,
): Promise<ShareSettings | null> {
  const current = await getShareSettings(db, presentationId, ownerId);
  if (!current) return null;

  const token = createId();
  await runStatements(db, [
    db
      .update(presentations)
      .set({ linkToken: token })
      .where(eq(presentations.id, presentationId)),
    db
      .delete(presentationMembers)
      .where(eq(presentationMembers.presentationId, presentationId)),
  ]);
  return { access: current.access, token };
}

export interface JoinResult {
  presentationId: string;
  role: PresentationRole;
  document: PresentationDocument;
}

/** 링크가 살아 있으면 멤버로 기록하고 문서를 돌려준다. 소유자는 기록하지 않는다. */
export async function joinByToken(
  db: DbInstance,
  token: string,
  userId: string,
): Promise<JoinResult | null> {
  const [target] = await db
    .select({ id: presentations.id, ownerId: presentations.userId })
    .from(presentations)
    .where(and(eq(presentations.linkToken, token), linkActiveCondition()));
  if (!target) return null;

  if (target.ownerId !== userId) {
    await db
      .insert(presentationMembers)
      .values({ presentationId: target.id, userId })
      .onConflictDoNothing();
  }

  const role = await resolvePresentationAccess(db, target.id, userId);
  const document = await getPresentationDocument(db, target.id, userId);
  if (!role || !document) return null;
  return { presentationId: target.id, role, document };
}
