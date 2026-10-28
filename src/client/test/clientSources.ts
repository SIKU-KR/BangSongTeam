import fs from "node:fs";
import path from "node:path";

const CLIENT_DIR = path.resolve(__dirname, "..");
const SKIPPED_DIRS = [
  path.join(CLIENT_DIR, "components", "ui"),
  path.join(CLIENT_DIR, "test"),
];

/**
 * `src/client`의 앱 소스 파일 목록. 소스를 훑어 규칙을 지키는지 보는 시험들이 함께 쓴다.
 * 테스트 파일과 테스트 도우미(`test/`)는 규칙의 대상이 아니고, shadcn이 만드는 `components/ui`는
 * 생성된 그대로 두므로 뺀다.
 */
export function clientSourceFiles(dir: string = CLIENT_DIR): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRS.includes(file) ? [] : clientSourceFiles(file);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [file]
      : [];
  });
}
