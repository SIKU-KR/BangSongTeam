/**
 * Cloudflare D1에서 뽑은 데이터를 Firestore로 옮긴다 (한 번 쓰는 이전 도구).
 *
 * 1. D1 테이블마다 JSON으로 뽑는다 (FTS 가상 테이블 때문에 `wrangler d1 export`는 쓰지 않는다):
 *      mkdir -p .data/d1-export
 *      for t in user session account verification folders presentations decks \
 *               presentation_members drive_tombstones backgrounds background_keywords reports; do
 *        pnpm dlx wrangler d1 execute bangsongteam-db-v2 --remote --json \
 *          --command "SELECT * FROM \"$t\"" > .data/d1-export/$t.json
 *      done
 * 2. R2 배경 객체를 같은 키로 GCS 버킷에 복사한다 (예: rclone `copy r2:bangsongteam-media gcs:<버킷>`,
 *    또는 Storage Transfer Service의 S3 호환 소스).
 * 3. 먼저 로컬 에뮬레이터에 넣어 확인한 뒤 운영 Firestore에 넣는다:
 *      node scripts/migrateFromCloudflare.mjs --dir=.data/d1-export --dry-run
 *      node scripts/migrateFromCloudflare.mjs --dir=.data/d1-export                 # 로컬
 *      node scripts/migrateFromCloudflare.mjs --dir=.data/d1-export --target=remote --confirm
 *
 * 문서 id는 D1 행 id 그대로라 여러 번 돌려도 같은 결과가 된다. 옮기는 동안 기존 서비스에서
 * 생긴 쓰기는 따라오지 않으므로, 운영 이전은 쓰기를 멈춘 상태에서 한 번에 한다.
 */

import fs from "node:fs";
import path from "node:path";
import {
  assertEmulatorUp,
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

async function main() {
  const args = parseFlags(process.argv.slice(2));
  const target = args.target ?? "local";
  if (!args.dir) throw new Error("--dir=<D1 내보내기 폴더>가 필요합니다");
  const dir = path.resolve(args.dir);

  const importer = await importSource("src/db/ops/importD1.ts");
  const tables = {};
  for (const table of importer.D1_TABLES) {
    const file = path.join(dir, `${table}.json`);
    if (fs.existsSync(file)) tables[table] = readRows(file);
    else console.warn(`[없음] ${table}.json — 이 테이블은 건너뜁니다`);
  }
  const docs = importer.convertD1Export(tables);

  const counts = {};
  for (const { collection } of docs) {
    counts[collection] = (counts[collection] ?? 0) + 1;
  }
  console.log(`대상: ${target} Firestore`);
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

  applyTarget(target);
  await assertEmulatorUp();
  const { getFirestore } = await importSource("src/db/client.ts");
  await importer.writeImportedDocs(getFirestore(), docs);
  console.log(`문서 ${docs.length}개를 옮겼습니다.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
