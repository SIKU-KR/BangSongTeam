import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type D1Client = DrizzleD1Database<typeof schema>;

export function createD1Client(d1: D1Database): D1Client {
  return drizzle(d1, { schema });
}
