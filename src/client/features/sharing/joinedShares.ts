import { z } from "zod";
import { IdSchema } from "#shared";

const MAX_REMEMBERED_LINKS = 50;

const JoinedSharesSchema = z.array(z.tuple([z.string(), IdSchema]));
type JoinedShares = z.infer<typeof JoinedSharesSchema>;

function storageKey(userId: string): string {
  return `chiton:share-targets:${userId}`;
}

function readShares(userId: string): JoinedShares {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (raw === null) return [];
    const parsed = JoinedSharesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function writeShares(userId: string, shares: JoinedShares): void {
  try {
    if (shares.length === 0) localStorage.removeItem(storageKey(userId));
    else localStorage.setItem(storageKey(userId), JSON.stringify(shares));
  } catch {
    return;
  }
}

/**
 * 링크로 참여한 프레젠테이션을 이 브라우저에 기억한다(링크 토큰 → 프레젠테이션 id). 공유받은
 * 사본은 어느 링크로 들어왔는지 모르고, 오프라인에서는 서버에 물을 수도 없다. 이 기록이 있어야
 * 같은 링크를 오프라인에서 열 때 저장해 둔 사본을 찾는다.
 *
 * 사용자별로 두어 같은 브라우저를 함께 쓰는 다른 계정의 링크를 열지 않는다. `localStorage`에
 * 두는 까닭은 `rememberDeckDelete`와 같고, 가장 최근 50개 링크만 남겨 기록이 끝없이 늘지 않게
 * 한다. 저장소를 쓸 수 없으면 기억하지 않는다.
 */
export function rememberJoinedShare(
  userId: string,
  token: string,
  presentationId: string,
): void {
  const others = readShares(userId).filter(([known]) => known !== token);
  const shares: JoinedShares = [...others, [token, presentationId]];
  writeShares(userId, shares.slice(-MAX_REMEMBERED_LINKS));
}

/** 그 링크로 참여했던 프레젠테이션 id. 기억이 없거나 읽을 수 없으면 `null`이다 */
export function recallJoinedShare(
  userId: string,
  token: string,
): string | null {
  return readShares(userId).find(([known]) => known === token)?.[1] ?? null;
}

/** 서버가 열 수 없다고 답한 링크의 기록을 지운다. 해제된 링크가 저장된 사본으로 다시 열리면 안 된다 */
export function forgetJoinedShare(userId: string, token: string): void {
  const shares = readShares(userId);
  const kept = shares.filter(([known]) => known !== token);
  if (kept.length !== shares.length) writeShares(userId, kept);
}
