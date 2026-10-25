import {
  Firestore,
  type BulkWriter,
  type Settings,
} from "@google-cloud/firestore";

export type Db = Firestore;

/**
 * Firestore 클라이언트를 만든다.
 *
 * - 프로젝트는 Cloud Run에서는 메타데이터 서버가, 로컬에서는 `GOOGLE_CLOUD_PROJECT`가 정한다.
 *   `FIRESTORE_EMULATOR_HOST`가 있으면 라이브러리가 에뮬레이터로 붙는다.
 * - `ignoreUndefinedProperties`: 선택 필드가 `undefined`로 들어와도 쓰기 전체가 실패하지
 *   않게 한다. 저장하는 문서는 비어 있는 값을 언제나 `null`로 쓴다.
 */
export function createFirestore(settings: Settings = {}): Db {
  return new Firestore({
    ignoreUndefinedProperties: true,
    ...settings,
  });
}

let shared: Db | undefined;

/** 프로세스 하나가 함께 쓰는 Firestore 클라이언트. 연결을 요청마다 새로 만들지 않는다. */
export function getFirestore(): Db {
  shared ??= createFirestore();
  return shared;
}

/**
 * 많은 문서를 BulkWriter로 쓴다. `write`가 돌려준 쓰기 중 하나라도 실패하면 첫 오류를
 * 던진다. 쓰기마다의 Promise를 받아 두지 않으면 실패가 처리되지 않은 거부로 남는다.
 */
export async function runBulk(
  db: Db,
  write: (writer: BulkWriter) => Promise<unknown>[],
): Promise<void> {
  const writer = db.bulkWriter();
  const settled = Promise.allSettled(write(writer));
  await writer.close();
  const failed = (await settled).find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}
