import { z } from "zod";
import {
  OmittedPresentationSchema,
  type OmittedPresentation,
  type Presentation,
  type PresentationListEntry,
} from "#shared";
import { ERROR_COPY } from "#copy/common";
import { ServerRejectedError } from "../api/request";
import { serverAlignedNow } from "../api/serverClock";
import { isSyncedWithServer } from "../../features/presentation/presentationDocument";
import { pullPresentation, pullPresentations } from "./presentationSync";

/**
 * 지난 받기를 시작한 시각에서 이만큼 앞선 때부터 바뀐 프레젠테이션의 곡을 목록과 함께 받는다(`since`).
 * 판은 고친 기기의 시계로 찍히고 저장은 조금 늦게 닿기도 해서, 지난 받기 뒤에 저장된 판이 그 시각보다
 * 이를 수 있다. 여유보다 이른 판도 머리로 와서 이 기기의 판과 견주므로, 여유는 따로 받는 요청만 줄인다.
 */
export const PULL_SINCE_MARGIN_MS = 10 * 60_000;

/**
 * 곡을 뺀 머리 가운데 따로 받아야 할 프레젠테이션이 이보다 많으면 목록 전체를 한 번 받는다. 저장소를
 * 비운 기기처럼 거의 모두 받아야 하면 요청 하나가 낫다.
 */
export const MAX_SEPARATE_PULLS = 20;

/** 서버가 보낸 프레젠테이션(곡까지 담은 문서나 곡을 뺀 머리) */
export type ServerPresentationRecord = Presentation | OmittedPresentation;

/** 서버 프레젠테이션 목록을 받은 결과 */
export interface PresentationPull {
  /**
   * 서버 목록의 모든 프레젠테이션. 곡을 뺀 머리는 이 기기의 같은 판이나 따로 받은 문서로 바꿔 두었고,
   * `keepsLocal`이 그대로 둔다고 한 세트는 뺐다.
   */
  documents: Presentation[];
  /** 이 받기를 시작한 서버 시각(ms). 반영을 마치면 `notePresentationsPulled`로 남긴다 */
  startedAt: number;
}

export interface PresentationPullOptions {
  /** 지금 이 탭의 프레젠테이션 */
  local: () => readonly Presentation[];
  /**
   * 그 머리의 서버 판이 무엇이든 병합이 이 기기의 세트를 그대로 둘지. 그렇다면 따로 받지 않고 목록에서
   * 뺀다. 다시 받기만 쓴다(올리지 않은 편집이 있거나 올리기를 기다리는 세트).
   */
  keepsLocal?: (local: Presentation, header: OmittedPresentation) => boolean;
  /**
   * 받은 목록마다 부른다. false면 더 요청하지 않고 받은 것을 버린다(다른 계정의 목록, 그사이 시작한 송출,
   * 바뀐 부팅).
   */
  proceed: (lists: readonly (readonly ServerPresentationRecord[])[]) => boolean;
}

function markKey(userId: string): string {
  return `presentation-pull:${userId}`;
}

function readMark(userId: string): number | null {
  try {
    const parsed = z.iso
      .datetime()
      .safeParse(localStorage.getItem(markKey(userId)));
    return parsed.success ? Date.parse(parsed.data) : null;
  } catch {
    return null;
  }
}

function writeMark(userId: string, at: string | null): void {
  try {
    if (at === null) localStorage.removeItem(markKey(userId));
    else localStorage.setItem(markKey(userId), at);
  } catch {
    return;
  }
}

/**
 * 그 사용자의 프레젠테이션 받기를 이 기기가 반영했다. 다음 받기는 이 받기를 시작한 서버 시각보다
 * `PULL_SINCE_MARGIN_MS` 앞선 때를 `since`로 보낸다.
 *
 * 받은 목록을 병합해 반영한 뒤에만 부른다. 받기가 실패했거나 받은 것을 버렸으면 남기지 않아 다음 받기가
 * 같은 때부터 다시 받는다. 사용자마다 `localStorage`에 둔다. 동기로 써지고 IndexedDB 버전을 올리지 않아도
 * 된다. 저장소를 쓸 수 없으면 남기지 않고, 다음 받기는 목록 전체를 받는다.
 */
export function notePresentationsPulled(
  userId: string | null,
  pull: PresentationPull,
): void {
  if (userId === null) return;
  writeMark(userId, new Date(pull.startedAt).toISOString());
}

async function requestList(
  userId: string | null,
  options: PresentationPullOptions,
): Promise<PresentationListEntry[] | null> {
  const mark = userId === null ? null : readMark(userId);
  if (userId === null || mark === null) return pullPresentations();
  try {
    return await pullPresentations(
      new Date(mark - PULL_SINCE_MARGIN_MS).toISOString(),
    );
  } catch (err) {
    if (!(err instanceof ServerRejectedError && err.status === 400)) throw err;
    writeMark(userId, null);
    if (!options.proceed([])) return null;
    return pullPresentations();
  }
}

interface SplitList {
  documents: Presentation[];
  omitted: OmittedPresentation[];
}

function marksOmittedCopies(
  entry: PresentationListEntry,
): entry is OmittedPresentation {
  const value: unknown = entry;
  return (
    typeof value === "object" && value !== null && "copiesOmitted" in value
  );
}

function splitList(
  entries: readonly PresentationListEntry[],
): SplitList | null {
  const documents: Presentation[] = [];
  const omitted: OmittedPresentation[] = [];
  for (const entry of entries) {
    if (!marksOmittedCopies(entry)) {
      documents.push(entry);
      continue;
    }
    const header = OmittedPresentationSchema.safeParse(entry);
    if (!header.success) return null;
    omitted.push(header.data);
  }
  return { documents, omitted };
}

function sameInstant(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = a ?? null;
  const right = b ?? null;
  if (left === null || right === null) return left === right;
  return Date.parse(left) === Date.parse(right);
}

function sameAccess(
  local: Presentation["access"],
  header: OmittedPresentation["access"],
): boolean {
  if (!local || !header) return local === header;
  return (
    local.ownerName === header.ownerName && local.memberId === header.memberId
  );
}

function isSameVersion(
  local: Presentation,
  header: OmittedPresentation,
): boolean {
  const confirmed =
    local.access !== undefined ||
    local.baseUpdatedAt === undefined ||
    isSyncedWithServer(local);
  return (
    confirmed &&
    local.items.every((item) => item.deck !== undefined) &&
    sameInstant(local.updatedAt, header.updatedAt) &&
    local.userId === header.userId &&
    sameAccess(local.access, header.access) &&
    local.title === header.title &&
    local.serviceDate === header.serviceDate &&
    (local.folderId ?? null) === (header.folderId ?? null) &&
    sameInstant(local.trashedAt, header.trashedAt)
  );
}

async function pullWholeList(
  startedAt: number,
  options: PresentationPullOptions,
): Promise<PresentationPull | null> {
  const listed = await pullPresentations();
  if (!options.proceed([listed])) return null;
  const whole = splitList(listed);
  if (!whole || whole.omitted.length > 0) {
    throw new Error(ERROR_COPY.requestFailed);
  }
  return { documents: whole.documents, startedAt };
}

/**
 * 서버의 프레젠테이션 목록을 받는다(부팅 동기화, 열려 있는 탭의 다시 받기). 결과는 목록 전체를 받은 것과
 * 같게 병합할 수 있는 서버 목록이다.
 *
 * 이 기기가 그 사용자의 받기를 반영한 적이 있으면(`notePresentationsPulled`) 그 뒤에 바뀐 프레젠테이션만
 * 곡까지 받고(`since`), 나머지는 머리만 받는다. 기록이 없는 기기(처음 쓰는 기기, 다른 사용자, 읽지 못한
 * 기록)와 로그인하지 않은 탭은 목록 전체를 받는다. 곡을 뺀 머리는 이렇게 맞춘다.
 * - 이 기기의 세트가 그 판 그대로면(서버와 맞춘 판이나 기준 판이 없는 이전 저장본이 같은 판이고, 폴더·
 *   휴지통·제목·날짜와 공유 정보도 같고, 곡이 빠진 항목이 없으면) 그 세트를 서버 판으로 쓴다. 판은 받은
 *   저장마다 커지므로 같은 판이면 같은 곡이다. 서버가 판을 올리지 않고 곡을 고친 경우(저장할 때 모르는
 *   배경을 비움, 배경을 지운 운영 작업)만 이 기기에 남고, 다른 기기가 그 세트를 고치거나 목록 전체를 받을
 *   때 맞춘다.
 * - 이 기기에 없거나 판이 다르거나 올리지 않은 편집이 있으면 그 프레젠테이션만 따로 받는다. 편집이 있는
 *   세트를 이 기기의 판으로 채우면 병합이 서버 판과 같다고 보고 편집을 올리지 않는다. `keepsLocal`이
 *   그대로 둔다는 세트는 받지 않고 뺀다.
 * - 따로 받을 것이 `MAX_SEPARATE_PULLS`보다 많거나, 따로 받는 사이 사라진 프레젠테이션이 있거나, 머리
 *   모양이 맞지 않으면 목록 전체를 다시 받는다.
 *
 * 서버가 `since`를 거절하면(400) 기록을 지우고 곧바로 목록 전체를 받는다. 기록이 틀렸을 때 '다시
 * 시도'를 누를 때까지 부팅 병합이 멈추지 않게 하기 위해서다. `since`를 모르는 이전 서버는 모두 담아 주므로
 * 그대로 쓴다. 요청마다 받은 목록을 `proceed`에 보이고(다시 받기 전에는 빈 목록으로 묻는다), 거절하면 더
 * 요청하지 않고 null을 돌려준다. 받기를 실패하면 그 오류를 던진다. 기록은 남기지 않는다. 반영한 쪽이
 * `notePresentationsPulled`로 남긴다.
 */
export async function pullServerPresentations(
  userId: string | null,
  options: PresentationPullOptions,
): Promise<PresentationPull | null> {
  const startedAt = serverAlignedNow();
  const listed = await requestList(userId, options);
  if (!listed || !options.proceed([listed])) return null;
  const split = splitList(listed);
  if (!split) return pullWholeList(startedAt, options);
  if (split.omitted.length === 0) {
    return { documents: split.documents, startedAt };
  }

  const local = new Map(options.local().map((doc) => [doc.id, doc]));
  const kept: Presentation[] = [];
  const separate: string[] = [];
  for (const header of split.omitted) {
    const mine = local.get(header.id);
    if (mine && isSameVersion(mine, header)) kept.push(mine);
    else if (!mine || !options.keepsLocal?.(mine, header)) {
      separate.push(header.id);
    }
  }
  if (separate.length > MAX_SEPARATE_PULLS) {
    return pullWholeList(startedAt, options);
  }

  const pulled = await Promise.all(separate.map((id) => pullPresentation(id)));
  const fetched = pulled.filter((doc) => doc !== null);
  if (!options.proceed([fetched])) return null;
  if (fetched.length < pulled.length) return pullWholeList(startedAt, options);
  return { documents: [...split.documents, ...kept, ...fetched], startedAt };
}
