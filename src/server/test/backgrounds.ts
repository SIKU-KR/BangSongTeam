import { backgroundsCol } from "#db";
import { deleteBackground } from "../../db/ops/backgrounds";
import { backgroundDoc } from "../../db/test/fixtures";
import { env } from "./env";

/**
 * API 테스트용 배경 문서. 배경이 필요한 테스트는 여기서 직접 만든다. 호출할 때마다
 * 기존 배경을 운영 작업과 같은 방식으로 지우고(쓰던 곡은 배경 없음) 다시 만든다.
 */
export function serviceBackgroundId(index: number): string {
  return `svc${String(index).padStart(18, "0")}`;
}

export async function resetBackgrounds(serviceCount = 0): Promise<string[]> {
  const existing = await backgroundsCol(env.DB).get();
  for (const doc of existing.docs) await deleteBackground(env.DB, doc.id);
  const batch = env.DB.batch();
  const ids = Array.from({ length: serviceCount }, (_, index) =>
    serviceBackgroundId(index + 1),
  );
  ids.forEach((id, index) =>
    batch.set(
      backgroundsCol(env.DB).doc(id),
      backgroundDoc({
        id,
        title: `사전 주입 ${index + 1}`,
        license: "Service Original (CC0)",
      }),
    ),
  );
  await batch.commit();
  return ids;
}
