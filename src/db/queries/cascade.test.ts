import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { createTestDb } from "../test/fixtures";
import {
  MAX_DELETION_PASSES,
  runDeletionPasses,
  type DeletionPass,
} from "./cascade";

function unfinishedPass(writes: number): DeletionPass {
  return {
    presentationIds: [],
    folderIds: [],
    writes,
    done: false,
    write: () => {},
  };
}

describe("runDeletionPasses", () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
  });

  it("아무것도 쓰지 않고 끝나지도 않는 차례가 나오면 다음 차례를 열지 않고 오류를 던진다", async () => {
    let passes = 0;

    await expect(
      runDeletionPasses(db, async () => {
        passes += 1;
        return unfinishedPass(0);
      }),
    ).rejects.toThrow();
    expect(passes).toBe(1);
  });

  it("쓰기만 하고 끝나지 않는 차례가 이어지면 MAX_DELETION_PASSES번까지만 돌고 오류를 던진다", async () => {
    let passes = 0;

    await expect(
      runDeletionPasses(db, async () => {
        passes += 1;
        return unfinishedPass(1);
      }),
    ).rejects.toThrow();
    expect(passes).toBe(MAX_DELETION_PASSES);
  });
});
