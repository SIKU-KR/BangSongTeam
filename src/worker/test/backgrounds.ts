import { env } from "cloudflare:test";
import { backgrounds, createD1Client } from "#db";

/**
 * 워커 테스트용 배경 행.
 *
 * 마이그레이션은 배경을 넣지 않으므로(R2 파일 없는 행 금지), 배경이 필요한 테스트는
 * 여기서 직접 만든다. 테스트 D1은 파일끼리 공유되므로 호출할 때마다 표를 비운다.
 */
export function serviceBackgroundId(index: number): string {
  return `svc${String(index).padStart(18, "0")}`;
}

export async function resetBackgrounds(serviceCount = 0): Promise<string[]> {
  await createD1Client(env.DB).delete(backgrounds);
  const ids = Array.from({ length: serviceCount }, (_, index) =>
    serviceBackgroundId(index + 1),
  );
  if (ids.length > 0) {
    await createD1Client(env.DB)
      .insert(backgrounds)
      .values(
        ids.map((id, index) => ({
          id,
          title: `사전 주입 ${index + 1}`,
          r2Key: `loops/${id}.mp4`,
          posterKey: `posters/${id}.webp`,
          durationSec: 20,
          license: "Service Original (CC0)",
          createdAt: new Date(0),
        })),
      );
  }
  return ids;
}
