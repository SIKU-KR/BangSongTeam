/**
 * Cloudflare(D1·R2) 데이터를 Firestore·GCS로 옮긴다 (한 번 쓰는 이전 도구).
 *
 * 운영 이전은 `scripts/migrateFromCloudflare.cloudbuild.yaml`로 Cloud Build에서 돌린다. R2 객체를
 * 같은 키로 GCS 버킷에 복사하고, 이 스크립트가 D1 HTTP API(`--d1=<데이터베이스 id>`)로 테이블을
 * 읽어 운영 Firestore에 쓴다. 로컬 에뮬레이터로 확인할 때는 테이블마다 뽑은 JSON 폴더를 넘긴다
 * (FTS 가상 테이블 때문에 `wrangler d1 export`는 쓰지 않는다):
 *      mkdir -p .data/d1-export
 *      for t in user session account verification folders presentations decks \
 *               presentation_members drive_tombstones backgrounds background_keywords; do
 *        pnpm dlx wrangler d1 execute bangsongteam-db-v2 --remote --json \
 *          --command "SELECT * FROM \"$t\"" > .data/d1-export/$t.json
 *      done
 *      node scripts/migrateFromCloudflare.mjs --dir=.data/d1-export --dry-run
 *      node scripts/migrateFromCloudflare.mjs --dir=.data/d1-export
 *
 * 문서 id는 D1 행 id 그대로라 대상이 비어 있는 동안에는 여러 번 돌려도 같은 결과가 된다. 옮기는
 * 동안 기존 서비스에서 생긴 쓰기는 따라오지 않으므로, 운영 이전은 쓰기를 멈춘 상태에서 한 번에 한다.
 * 도메인을 옮겨 새 서비스에 사용자가 생긴 뒤에 다시 돌리면 그 뒤의 쓰기를 D1의 옛 값으로
 * 덮어쓰므로, 대상에 사용자가 이미 있으면 쓰지 않고 멈춘다. 롤백한 뒤 다시 옮기거나 멈춘 이전을 이어
 * 갈 때만 `--overwrite-existing`을 붙인다.
 */

import fs from "node:fs";
import path from "node:path";
import {
  assertEmulatorUp,
  describeTarget,
  importSource,
  parseFlags,
  applyTarget,
} from "./lib/targets.mjs";

/** `wrangler d1 execute --json` 출력(`[{ results: [...] }]`)과 행 배열을 모두 받는다 */
function readRows(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (Array.isArray(parsed) && parsed.every((entry) => entry?.results)) {
    return parsed.flatMap((entry) => entry.results);
  }
  if (Array.isArray(parsed)) return parsed;
  throw new Error(`알 수 없는 JSON 형식: ${file}`);
}

/** D1 HTTP API로 테이블 전체를 읽는다. `CLOUDFLARE_ACCOUNT_ID`·`CLOUDFLARE_API_TOKEN`(D1 읽기)이 필요하다 */
async function fetchD1Rows(databaseId, table) {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } =
    process.env;
  if (!account || !token) {
    throw new Error(
      "--d1에는 CLOUDFLARE_ACCOUNT_ID와 CLOUDFLARE_API_TOKEN 환경 변수가 필요합니다",
    );
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql: `SELECT * FROM "${table}"` }),
    },
  );
  const body = await response.json();
  if (!response.ok || !body.success) {
    throw new Error(`D1 ${table} 읽기 실패: ${JSON.stringify(body.errors)}`);
  }
  return body.result.flatMap((entry) => entry.results);
}

async function main() {
  const args = parseFlags(process.argv.slice(2));
  const target = args.target ?? "local";
  if (!args.dir && !args.d1) {
    throw new Error(
      "--dir=<D1 내보내기 폴더> 또는 --d1=<D1 데이터베이스 id>가 필요합니다",
    );
  }
  applyTarget(target);

  const importer = await importSource("src/db/ops/importD1.ts");
  const tables = {};
  for (const table of importer.D1_TABLES) {
    if (args.d1) {
      tables[table] = await fetchD1Rows(args.d1, table);
      continue;
    }
    const file = path.join(path.resolve(args.dir), `${table}.json`);
    if (fs.existsSync(file)) tables[table] = readRows(file);
    else console.warn(`[없음] ${table}.json — 이 테이블은 건너뜁니다`);
  }
  const docs = importer.convertD1Export(tables);

  const counts = {};
  for (const { collection } of docs) {
    counts[collection] = (counts[collection] ?? 0) + 1;
  }
  console.log(`대상: ${describeTarget(target)}`);
  console.table(counts);

  if (args["dry-run"]) {
    console.log("--dry-run이므로 아무것도 쓰지 않았습니다.");
    return;
  }
  if (target === "remote" && !args.confirm) {
    throw new Error(
      "운영 Firestore에 쓰려면 --dry-run 결과를 확인한 뒤 --confirm을 붙여 주세요",
    );
  }

  await assertEmulatorUp();
  const { getFirestore } = await importSource("src/db/client.ts");
  await importer.writeImportedDocs(getFirestore(), docs, {
    overwriteExisting: args["overwrite-existing"] === true,
  });
  console.log(`문서 ${docs.length}개를 옮겼습니다.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
