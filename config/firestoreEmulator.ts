import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { TestProject } from "vitest/node";

/** 개발용 에뮬레이터(8080)와 다른 포트. `config/firebase.test.json`과 맞춘다 */
const TEST_HOST = "127.0.0.1:8085";
const START_TIMEOUT_MS = 120_000;

async function isUp(host: string): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}/`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitUntilUp(host: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Firestore 에뮬레이터가 시작하지 못했습니다 (exit ${child.exitCode}). Java가 설치돼 있는지 확인하세요.`,
      );
    }
    if (await isUp(host)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Firestore 에뮬레이터를 기다리다 시간이 지났습니다.");
}

/**
 * 서버·DB 테스트가 쓸 Firestore 에뮬레이터를 준비한다 (vitest `globalSetup`).
 *
 * `FIRESTORE_EMULATOR_HOST`를 주면 그 에뮬레이터를 쓴다. 없으면 개발용(`pnpm emulators`)과
 * 다른 포트에 테스트 전용 에뮬레이터를 띄웠다가 끝나면 끈다. 개발용 에뮬레이터는 저장해 둔
 * 데이터를 불러오며 띄우는데, 불러온 문서가 모든 프로젝트 id에 보여 테스트와 섞인다. 주소는 테스트 워커에
 * `inject`로 넘긴다(`firestoreEmulatorEnv.ts`). 테스트는 파일·케이스마다
 * 다른 프로젝트 id를 써서 서로의 데이터도, 개발용 데이터도 건드리지 않는다.
 */
export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? TEST_HOST;
  project.provide("firestoreEmulatorHost", host);
  if (await isUp(host)) return async () => {};

  const rootDir = path.resolve(import.meta.dirname, "..");
  const child = spawn(
    path.join(rootDir, "node_modules/.bin/firebase"),
    [
      "emulators:start",
      "--only",
      "firestore",
      "--project",
      "demo-bangsongteam-test",
      "--config",
      "config/firebase.test.json",
    ],
    { cwd: rootDir, stdio: "ignore" },
  );
  await waitUntilUp(host, child);

  return async () => {
    child.kill("SIGINT");
    await new Promise((resolve) => child.once("exit", resolve));
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    firestoreEmulatorHost: string;
  }
}
