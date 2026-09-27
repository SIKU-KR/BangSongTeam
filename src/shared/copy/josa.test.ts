import { describe, it, expect } from "vitest";
import { withDirectionParticle, withObjectParticle } from "./josa";

describe("조사", () => {
  it("받침에 맞춰 조사를 고른다", () => {
    expect(withObjectParticle("‘주일’")).toBe("‘주일’을");
    expect(withObjectParticle("‘청년부’")).toBe("‘청년부’를");
    expect(withObjectParticle("‘테스트 프레젠테이션 (사본)’")).toBe(
      "‘테스트 프레젠테이션 (사본)’을",
    );
    expect(withObjectParticle("3개 항목")).toBe("3개 항목을");
    expect(withObjectParticle("‘Youth’")).toBe("‘Youth’을(를)");
    expect(withDirectionParticle("‘주일’")).toBe("‘주일’로");
    expect(withDirectionParticle("‘예배당’")).toBe("‘예배당’으로");
    expect(withDirectionParticle("‘청년부’")).toBe("‘청년부’로");
    expect(withDirectionParticle("‘2026’")).toBe("‘2026’(으)로");
  });
});
