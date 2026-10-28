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

/**
 * `--target` 값을 확인하고 그 대상의 Firestore 연결 환경 변수를 맞춘다.
 *
 * - local: 비어 있는 값도 없는 값으로 보고 기본값을 채운다(`||=`). Firestore SDK는 빈
 *   `FIRESTORE_EMULATOR_HOST`를 설정 없음으로 읽어 운영 Firestore에 붙으므로, `??=`로는
 *   `FIRESTORE_EMULATOR_HOST=`가 내보내진 셸에서 시드가 운영 데이터를 지운다.
 *   `GCLOUD_PROJECT`는 google-auth-library가 `GOOGLE_CLOUD_PROJECT`보다 먼저 읽어서 지운다.
 * - remote: 두 프로젝트 변수가 서로 다른 프로젝트를 가리키면 어느 쪽에 쓸지 알 수 없어 멈춘다.
 */
export function applyTarget(target) {
  if (target === "local") {
    process.env.FIRESTORE_EMULATOR_HOST ||= LOCAL_EMULATOR_HOST;
    process.env.GOOGLE_CLOUD_PROJECT ||= LOCAL_PROJECT_ID;
    process.env.METADATA_SERVER_DETECTION ||= "none";
    delete process.env.GCLOUD_PROJECT;
    return;
  }
  if (target !== "remote") {
    throw new Error(`--target은 local 또는 remote여야 합니다: ${target}`);
  }
  delete process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "--target=remote에는 GOOGLE_CLOUD_PROJECT 환경 변수가 필요합니다",
    );
  }
  const legacyProject = process.env.GCLOUD_PROJECT;
  if (legacyProject && legacyProject !== project) {
    throw new Error(
      `GCLOUD_PROJECT(${legacyProject})와 GOOGLE_CLOUD_PROJECT(${project})가 다릅니다. 하나만 남기거나 같은 값으로 맞춰 주세요`,
    );
  }
}

/**
 * `applyTarget` 뒤에 어느 Firestore에 쓰는지 한 줄로 알려 준다. 스크립트는 쓰기 전에
 * 이 줄을 출력해, `--confirm`을 붙이기 전에 프로젝트를 눈으로 확인하게 한다.
 */
export function describeTarget(target) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  return target === "local"
    ? `로컬 에뮬레이터 ${process.env.FIRESTORE_EMULATOR_HOST} (프로젝트 ${project})`
    : `운영 Firestore (프로젝트 ${project})`;
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

const ID_SHAPE = /^[\w-]{21}$/;

/**
 * 명령줄을 위치 인자와 옵션으로 나눈다. `spec`에 적은 옵션(`"boolean"` 또는 `"string"`)과
 * `--target`만 받고, 그 밖의 옵션은 Firestore에 연결하기 전에 막는다. `--aply`나
 * `--tagret=remote` 같은 오타가 조용히 무시되면 미리보기로 끝나거나 엉뚱한 대상에 쓴다.
 *
 * id는 NanoID(21자, `A-Za-z0-9_-`)라 `--`로 시작할 수 있어 그 모양인 인자는 위치 인자로 읽는다.
 * 옵션 이름은 모두 21자보다 짧거나 `=`가 들어가 id와 겹치지 않는다.
 */
export function parseOptions(argv, spec) {
  const types = { target: "string", ...spec };
  const isOption = (arg) => arg.startsWith("--") && !ID_SHAPE.test(arg);
  const flags = parseFlags(argv.filter(isOption));
  for (const [name, value] of Object.entries(flags)) {
    const type = Object.hasOwn(types, name) ? types[name] : undefined;
    if (type === undefined) throw new Error(`모르는 옵션이에요: --${name}`);
    if (type === "boolean" && value !== true) {
      throw new Error(`--${name}에는 값을 붙이지 않아요`);
    }
    if (type === "string" && typeof value !== "string") {
      throw new Error(`--${name}=<값> 형식으로 써 주세요`);
    }
  }
  return { positionals: argv.filter((arg) => !isOption(arg)), flags };
}

/**
 * 스크립트의 `main`을 돌리고 프로세스를 끝낸다. 실패하면 오류 문장만 찍고 1로 끝낸다.
 *
 * 파이프로 이어진 stdout은 비동기라 곧바로 `process.exit()`하면 뒤쪽 출력이 잘린다
 * (`… | less`). 남은 출력을 다 보낸 뒤에 끝낸다.
 * https://nodejs.org/api/process.html#a-note-on-process-io
 */
export function runScript(main) {
  process.stdout.on("error", (error) => {
    if (error.code !== "EPIPE") throw error;
  });
  const flush = (stream) => new Promise((resolve) => stream.write("", resolve));
  const exit = async (code) => {
    await Promise.all([flush(process.stdout), flush(process.stderr)]);
    process.exit(code);
  };
  main().then(
    () => exit(process.exitCode ?? 0),
    (error) => {
      console.error(error.stderr?.trim() || error.message);
      return exit(1);
    },
  );
}
