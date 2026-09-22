import { applyD1Migrations, env } from "cloudflare:test";

/**
 * 테스트 D1에 실제 마이그레이션을 적용한다.
 *
 * 예전에는 각 테스트가 `env.DB.exec("CREATE TABLE ...")` 문자열로 테이블을
 * 만들었다. 그러면 `packages/db/drizzle/0000_initial.sql`과 조용히 갈라져,
 * 스키마가 바뀌어도 테스트는 옛 구조 위에서 계속 통과한다.
 *
 * `applyD1Migrations`는 적용 이력을 테이블로 관리해 멱등하다.
 */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
