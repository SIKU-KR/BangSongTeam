/**
 * 로컬 개발용 Firestore 에뮬레이터를 띄운다 (`pnpm emulators`). 끌 때(Ctrl+C) 데이터를
 * `.data/firestore`에 저장하고 다음 실행에 다시 불러온다. 프로젝트 id는 `demo-`로 시작해
 * 실제 Google Cloud 프로젝트에 닿지 않는다. Java 21 이상이 필요하다.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { LOCAL_PROJECT_ID, ROOT_DIR } from "./lib/targets.mjs";

const DATA_DIR = path.join(ROOT_DIR, ".data", "firestore");
const hasSavedData = fs.existsSync(
  path.join(DATA_DIR, "firebase-export-metadata.json"),
);
fs.mkdirSync(DATA_DIR, { recursive: true });

const child = spawn(
  path.join(ROOT_DIR, "node_modules", ".bin", "firebase"),
  [
    "emulators:start",
    "--only",
    "firestore",
    "--project",
    LOCAL_PROJECT_ID,
    "--export-on-exit",
    DATA_DIR,
    ...(hasSavedData ? ["--import", DATA_DIR] : []),
  ],
  { cwd: ROOT_DIR, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
