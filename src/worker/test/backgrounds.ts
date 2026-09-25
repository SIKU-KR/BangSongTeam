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
          tags: JSON.stringify(["잔잔한"]),
        })),
      );
  }
  return ids;
}

/**
 * 마이그레이션 `0002` 이전의 사용자 업로드 행. 앱은 이 행을 어떤 경로로도 내보내지
 * 않아야 한다 (운영 D1에 남아 있을 경우를 대비한 회귀 검사용).
 */
export async function insertUserBackgroundRow(
  ownerUserId: string,
  id: string,
  sizeBytes = 1000,
): Promise<void> {
  await createD1Client(env.DB)
    .insert(backgrounds)
    .values({
      id,
      title: "본당 배경",
      r2Key: `uploads/${ownerUserId}/${id}.mp4`,
      posterKey: `uploads/${ownerUserId}/${id}.poster.webp`,
      durationSec: 10,
      license: "사용자 업로드",
      tags: "[]",
      source: "user",
      ownerUserId,
      kind: "video",
      sizeBytes,
    });
}
