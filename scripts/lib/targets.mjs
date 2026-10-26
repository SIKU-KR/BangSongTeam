/**
 * 운영 스크립트가 함께 쓰는 대상(local·remote) 설정.
 *
 * - local: Firestore 에뮬레이터(`pnpm emulators`, 기본 127.0.0.1:8080)와 로컬 미디어 폴더
 *   (`.data/media`). `pnpm dev`가 보는 것과 같다.
 * - remote: 운영 Firestore와 GCS 버킷. `gcloud auth application-default login`으로 받은
 *   자격 증명과 `GOOGLE_CLOUD_PROJECT`(미디어를 다루면 `MEDIA_BUCKET`도) 환경 변수가 있어야 한다.
 *
 * `src/db`의 TypeScript 모듈은 `#shared` 같은 패키지 import를 써서 Node가 바로 읽지 못하므로
 * vite의 `runnerImport`로 불러온다.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

export const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const LOCAL_PROJECT_ID = "demo-bangsongteam";
export const LOCAL_EMULATOR_HOST = "127.0.0.1:8080";
export const LOCAL_MEDIA_DIR = path.join(ROOT_DIR, ".data", "media");

/** `--target` 값을 확인하고 그 대상의 Firestore 연결 환경 변수를 맞춘다 */
export function applyTarget(target) {
  if (target === "local") {
    process.env.FIRESTORE_EMULATOR_HOST ??= LOCAL_EMULATOR_HOST;
    process.env.GOOGLE_CLOUD_PROJECT ??= LOCAL_PROJECT_ID;
    process.env.METADATA_SERVER_DETECTION ??= "none";
    return;
  }
  if (target !== "remote") {
    throw new Error(`--target은 local 또는 remote여야 합니다: ${target}`);
  }
  delete process.env.FIRESTORE_EMULATOR_HOST;
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    throw new Error(
      "--target=remote에는 GOOGLE_CLOUD_PROJECT 환경 변수가 필요합니다",
    );
  }
}

/** 로컬 에뮬레이터가 떠 있는지 확인한다 */
export async function assertEmulatorUp() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) return;
  try {
    await fetch(`http://${host}/`);
  } catch {
    throw new Error(
      `Firestore 에뮬레이터(${host})에 닿지 않습니다. 다른 터미널에서 pnpm emulators를 먼저 실행해 주세요.`,
    );
  }
}

/** `src/` 아래 TypeScript 모듈을 불러온다 */
export async function importSource(relativePath) {
  const { module } = await runnerImport(path.join(ROOT_DIR, relativePath));
  return module;
}

/** 대상의 미디어 저장소에 파일을 올리고 지운다 */
export async function mediaTarget(target) {
  if (target === "local") {
    return {
      label: `로컬 폴더 ${path.relative(ROOT_DIR, LOCAL_MEDIA_DIR)}`,
      async put(key, file) {
        const out = path.join(LOCAL_MEDIA_DIR, key);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.copyFileSync(file, out);
      },
      async remove(key) {
        fs.rmSync(path.join(LOCAL_MEDIA_DIR, key), { force: true });
      },
    };
  }
  if (!process.env.MEDIA_BUCKET) {
    throw new Error("--target=remote에는 MEDIA_BUCKET 환경 변수가 필요합니다");
  }
  const { Storage } = await import("@google-cloud/storage");
  const bucket = new Storage().bucket(process.env.MEDIA_BUCKET);
  return {
    label: `GCS 버킷 ${process.env.MEDIA_BUCKET}`,
    async put(key, file, contentType) {
      await bucket.upload(file, {
        destination: key,
        contentType,
        resumable: fs.statSync(file).size > 8 * 1024 * 1024,
      });
    },
    async remove(key) {
      await bucket.file(key).delete({ ignoreNotFound: true });
    },
  };
}

/** `--key=value`, `--flag` 인자를 객체로 읽는다 */
export function parseFlags(argv) {
  return Object.fromEntries(
    argv.map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, "").split("=");
      return [key, rest.length > 0 ? rest.join("=") : true];
    }),
  );
}
