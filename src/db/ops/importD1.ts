import type { DocumentData } from "@google-cloud/firestore";
import { OPS_ERRORS } from "#shared";
import { runBulk, type Db } from "../client";
import { COLLECTIONS, memberDocId, type DeckDoc } from "../collections";
import { withDeckIndex } from "../deckIndex";

/** 옮겨 올 D1 테이블 (`wrangler d1 execute --json`으로 테이블마다 뽑은 행) */
export const D1_TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "folders",
  "presentations",
  "decks",
  "presentation_members",
  "drive_tombstones",
  "backgrounds",
  "background_keywords",
  "reports",
] as const;

export type D1TableName = (typeof D1_TABLES)[number];
export type D1Row = Record<string, unknown>;
export type D1Export = Partial<Record<D1TableName, D1Row[]>>;

export interface ImportedDoc {
  collection: string;
  id: string;
  data: DocumentData;
}

/**
 * Better Auth 테이블은 Drizzle `timestamp`(초), 앱 테이블은 `timestamp_ms`(밀리초)로
 * 시각을 저장했다.
 */
const SECOND_TABLES = new Set<D1TableName>([
  "user",
  "session",
  "account",
  "verification",
]);

const TIME_COLUMNS = new Set([
  "created_at",
  "updated_at",
  "expires_at",
  "access_token_expires_at",
  "refresh_token_expires_at",
  "terms_agreed_at",
  "published_at",
  "taken_down_at",
  "trashed_at",
  "resolved_at",
]);

const BOOLEAN_COLUMNS = new Set(["email_verified"]);

const RENAMED_COLUMNS: Record<string, string> = {
  r2_key: "mediaKey",
  taken_down_at: "takedownAt",
};

function camel(column: string): string {
  return (
    RENAMED_COLUMNS[column] ??
    column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  );
}

function convertValue(
  table: D1TableName,
  column: string,
  value: unknown,
): unknown {
  if (value === undefined || value === null) return null;
  if (TIME_COLUMNS.has(column)) {
    const n = Number(value);
    return new Date(SECOND_TABLES.has(table) ? n * 1000 : n);
  }
  if (BOOLEAN_COLUMNS.has(column)) return Boolean(Number(value));
  return value;
}

/** D1 행 하나를 Firestore 필드로 바꾼다: 이름은 camelCase, 시각은 Date, 0/1은 boolean */
export function convertRow(table: D1TableName, row: D1Row): DocumentData {
  const out: DocumentData = {};
  for (const [column, value] of Object.entries(row)) {
    out[camel(column)] = convertValue(table, column, value);
  }
  return out;
}

const COLLECTION_OF: Partial<Record<D1TableName, string>> = {
  user: COLLECTIONS.users,
  session: COLLECTIONS.sessions,
  account: COLLECTIONS.accounts,
  verification: COLLECTIONS.verifications,
  folders: COLLECTIONS.folders,
  presentations: COLLECTIONS.presentations,
  reports: COLLECTIONS.reports,
};

/**
 * D1 내보내기를 Firestore 문서 목록으로 바꾼다.
 *
 * - 곡은 공개 범위·검색 색인(`withDeckIndex`)을 붙인다. FTS 테이블은 옮기지 않는다.
 * - 배경 키워드 행은 배경 문서의 `keywords` 배열로 모은다.
 * - 멤버·영구 삭제 기록은 앱이 찾는 문서 id(`memberDocId`, 항목 id)로 쓴다.
 */
export function convertD1Export(tables: D1Export): ImportedDoc[] {
  const docs: ImportedDoc[] = [];

  for (const [table, collection] of Object.entries(COLLECTION_OF) as [
    D1TableName,
    string,
  ][]) {
    for (const row of tables[table] ?? []) {
      const data = convertRow(table, row);
      docs.push({ collection, id: String(data.id), data });
    }
  }

  for (const row of tables.decks ?? []) {
    const data = convertRow("decks", row) as Omit<
      DeckDoc,
      "listed" | "searchGrams"
    >;
    docs.push({
      collection: COLLECTIONS.decks,
      id: data.id,
      data: withDeckIndex(data),
    });
  }

  for (const row of tables.presentation_members ?? []) {
    const data = convertRow("presentation_members", row);
    docs.push({
      collection: COLLECTIONS.presentationMembers,
      id: memberDocId(String(data.presentationId), String(data.userId)),
      data,
    });
  }

  for (const row of tables.drive_tombstones ?? []) {
    const data = convertRow("drive_tombstones", row);
    docs.push({
      collection: COLLECTIONS.driveTombstones,
      id: String(data.itemId),
      data,
    });
  }

  const keywords = new Map<string, string[]>();
  for (const row of tables.background_keywords ?? []) {
    const id = String(row.background_id);
    keywords.set(id, [...(keywords.get(id) ?? []), String(row.keyword)]);
  }
  for (const row of tables.backgrounds ?? []) {
    const data = convertRow("backgrounds", row);
    docs.push({
      collection: COLLECTIONS.backgrounds,
      id: String(data.id),
      data: { ...data, keywords: keywords.get(String(data.id)) ?? [] },
    });
  }

  return docs;
}

/**
 * 대상 Firestore에 사용자가 하나도 없는지 확인한다. 이전 뒤에는 사용자가 새 서비스에서 데이터를
 * 쓰므로, 이미 사용자가 있으면 다시 옮기는 일이 그 뒤의 쓰기와 게시 중단을 D1의 옛 값으로
 * 덮어쓴다.
 */
export async function assertImportTargetEmpty(db: Db): Promise<void> {
  const existing = await db.collection(COLLECTIONS.users).limit(1).get();
  if (!existing.empty) throw new Error(OPS_ERRORS.importTargetNotEmpty);
}

/**
 * 바꾼 문서를 모두 쓴다. 같은 id가 있으면 덮어쓰므로 대상이 비어 있는 동안에는 여러 번 돌려도
 * 결과가 같다. 하지만 이전 뒤 새 서비스에서 생긴 쓰기까지 되돌리므로 기본으로는 사용자가 이미
 * 있는 대상에 쓰지 않는다. 롤백한 뒤 다시 옮기거나 멈춘 이전을 이어 갈 때만 `overwriteExisting`을 쓴다.
 */
export async function writeImportedDocs(
  db: Db,
  docs: readonly ImportedDoc[],
  { overwriteExisting = false }: { overwriteExisting?: boolean } = {},
): Promise<void> {
  if (!overwriteExisting) await assertImportTargetEmpty(db);
  await runBulk(db, (writer) =>
    docs.map(({ collection, id, data }) =>
      writer.set(db.collection(collection).doc(id), data),
    ),
  );
}
