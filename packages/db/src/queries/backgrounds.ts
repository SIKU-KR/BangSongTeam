import { asc } from "drizzle-orm";
import { backgrounds, type Background } from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/**
 * 모션 배경 메타데이터 전체 목록 조회
 */
export async function getBackgrounds(db: DbInstance): Promise<Background[]> {
  return db.select().from(backgrounds).orderBy(asc(backgrounds.title));
}
