import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const content = fs.readFileSync(
  path.join(
    path.resolve(__dirname, ".."),
    "scripts/migrateFromCloudflare.cloudbuild.yaml",
  ),
  "utf-8",
);

const step = (id: string): string =>
  content.slice(content.indexOf(`- id: ${id}`)).split(/\n {2}- id: /)[0] ?? "";

describe("Cloudflare 데이터 이전 Cloud Build 설정", () => {
  it("미디어 복사와 Firestore 쓰기를 따로 켠다", () => {
    expect(content).toMatch(/^ {2}_APPLY_MEDIA: "false"$/m);
    expect(content).toMatch(/^ {2}_APPLY_FIRESTORE: "false"$/m);
    expect(content).not.toMatch(/\b_APPLY\b/);

    expect(step("media")).toContain("${_APPLY_MEDIA}");
    expect(step("media")).not.toContain("_APPLY_FIRESTORE");
    expect(step("firestore")).toContain("${_APPLY_FIRESTORE}");
    expect(step("firestore")).not.toContain("_APPLY_MEDIA");
  });

  it("사용자가 있는 대상을 덮어쓰는 옵션은 따로 켠 때만 넘긴다", () => {
    expect(content).toMatch(/^ {2}_OVERWRITE_EXISTING: "false"$/m);
    expect(step("firestore")).toMatch(
      /if \[ "\$\{_OVERWRITE_EXISTING\}" = true \]; then flags="\$flags --overwrite-existing"; fi/,
    );
    expect(step("media")).not.toContain("overwrite");
  });
});
