import type { D1Migration } from "@cloudflare/vitest-plugin";

/** workerd 테스트에서 실제 D1 마이그레이션을 전달하는 바인딩. */
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
