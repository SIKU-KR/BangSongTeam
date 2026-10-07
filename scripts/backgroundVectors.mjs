/**
 * 배경 임베딩을 Vectorize 인덱스에 맞추는 공용 함수. `importBackgrounds.mjs`와
 * `seedLocal.mjs`가 쓴다.
 *
 * 임베딩은 `getPlatformProxy`의 원격 AI 바인딩으로 만든다. wrangler 로그인만 있으면 되고
 * API 토큰이 따로 필요 없다. 인덱스는 대상(local·remote)마다 달라 바인딩 대신 wrangler
 * CLI로 쓴다.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import {
  BACKGROUND_EMBEDDING_BATCH_SIZE,
  BACKGROUND_EMBEDDING_MODEL,
  BACKGROUND_INDEX_NAMES,
  backgroundEmbeddingDocument,
} from "../src/shared/utils/backgroundEmbedding.ts";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function wrangler(args) {
  return execFileSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: ROOT_DIR,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function embedDocuments(documents) {
  const proxy = await getPlatformProxy({
    configPath: path.join(ROOT_DIR, "wrangler.jsonc"),
    remoteBindings: true,
  });
  try {
    const vectors = [];
    for (
      let start = 0;
      start < documents.length;
      start += BACKGROUND_EMBEDDING_BATCH_SIZE
    ) {
      const { data } = await proxy.env.AI.run(BACKGROUND_EMBEDDING_MODEL, {
        documents: documents.slice(
          start,
          start + BACKGROUND_EMBEDDING_BATCH_SIZE,
        ),
      });
      vectors.push(...data);
    }
    return vectors;
  } finally {
    await proxy.dispose();
  }
}

/**
 * 배경들을 임베딩해 대상 인덱스에 upsert한다. 벡터 id는 배경 id다. 배경 수가 적어 매번
 * 전부 다시 임베딩한다.
 *
 * @param items `{ id, title, description?, searchText?, keywords }` 목록
 */
export async function upsertBackgroundVectors(target, items) {
  if (items.length === 0) return;
  const vectors = await embedDocuments(items.map(backgroundEmbeddingDocument));
  const file = path.join(
    os.tmpdir(),
    `bangsong-background-vectors-${process.pid}.ndjson`,
  );
  fs.writeFileSync(
    file,
    items
      .map((item, index) =>
        JSON.stringify({ id: item.id, values: vectors[index] }),
      )
      .join("\n"),
    "utf-8",
  );
  try {
    wrangler([
      "vectorize",
      "upsert",
      BACKGROUND_INDEX_NAMES[target],
      `--file=${file}`,
    ]);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** 지운 배경의 벡터를 대상 인덱스에서 뺀다. 없는 id는 무시된다 */
export function deleteBackgroundVectors(target, ids) {
  if (ids.length === 0) return;
  wrangler([
    "vectorize",
    "delete-vectors",
    BACKGROUND_INDEX_NAMES[target],
    "--ids",
    ...ids,
  ]);
}
