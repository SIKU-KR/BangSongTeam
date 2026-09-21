import { backgrounds, type NewBackground } from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/**
 * PRD M0 규격 10개 기본 모션 비디오 메타데이터
 * 분류 축: 분위기(잔잔한 / 밝은 / 웅장한) × 주조색(따뜻한 / 차가운 / 어두운)
 */
export const initialBackgrounds: NewBackground[] = [
  {
    id: "b0000000-0000-0000-0000-000000000001",
    title: "은은한 빛의 흐름",
    r2Key: "loops/warm_light_flow.mp4",
    posterKey: "posters/warm_light_flow.webp",
    durationSec: 20,
    license: "Service Original (CC0)",
    tags: JSON.stringify(["잔잔한", "따뜻한"]),
  },
  {
    id: "b0000000-0000-0000-0000-000000000002",
    title: "고요한 호수 물결",
    r2Key: "loops/calm_lake_waves.mp4",
    posterKey: "posters/calm_lake_waves.webp",
    durationSec: 24,
    license: "Service Original (CC0)",
    tags: JSON.stringify(["잔잔한", "차가운"]),
  },
  {
    id: "b0000000-0000-0000-0000-000000000003",
    title: "깊은 밤의 별빛",
    r2Key: "loops/night_starlight.mp4",
    posterKey: "posters/night_starlight.webp",
    durationSec: 30,
    license: "Service Original (CC0)",
    tags: JSON.stringify(["잔잔한", "어두운"]),
  },
  {
    id: "b0000000-0000-0000-0000-000000000004",
    title: "아침 햇살의 광채",
    r2Key: "loops/morning_sunlight.mp4",
    posterKey: "posters/morning_sunlight.webp",
    durationSec: 18,
    license: "Service Original (CC0)",
    tags: JSON.stringify(["밝은", "따뜻한"]),
  },
  {
    id: "b0000000-0000-0000-0000-000000000005",
    title: "푸른 하늘 구름",
    r2Key: "loops/blue_sky_clouds.mp4",
    posterKey: "posters/blue_sky_clouds.webp",
    durationSec: 22,
    license: "Service Original (CC0)",
    tags: JSON.stringify(["밝은", "차가운"]),
  },
  {
    id: "b0000000-0000-0000-0000-000000000006",
    title: "새벽 미명의 안개",
    r2Key: "loops/dawn_mist.mp4",
    posterKey: "posters/dawn_mist.webp",
    durationSec: 25,
    license: "Service Original (CC0)",
    tags: JSON.stringify(["밝은", "어두운"]),
  },
  {
    id: "b0000000-0000-0000-0000-000000000007",
    title: "타오르는 영광의 불꽃",
    r2Key: "loops/glory_fire.mp4",
    posterKey: "posters/glory_fire.webp",
    durationSec: 16,
    license: "Service Original (CC0)",
    tags: JSON.stringify(["웅장한", "따뜻한"]),
  },
  {
    id: "b0000000-0000-0000-0000-000000000008",
    title: "장엄한 푸른 파도",
    r2Key: "loops/majestic_ocean.mp4",
    posterKey: "posters/majestic_ocean.webp",
    durationSec: 20,
    license: "Service Original (CC0)",
    tags: JSON.stringify(["웅장한", "차가운"]),
  },
  {
    id: "b0000000-0000-0000-0000-000000000009",
    title: "광활한 은하수 공간",
    r2Key: "loops/cosmic_galaxy.mp4",
    posterKey: "posters/cosmic_galaxy.webp",
    durationSec: 30,
    license: "Service Original (CC0)",
    tags: JSON.stringify(["웅장한", "어두운"]),
  },
  {
    id: "b0000000-0000-0000-0000-000000000010",
    title: "찬란한 빛의 기둥",
    r2Key: "loops/radiant_pillars.mp4",
    posterKey: "posters/radiant_pillars.webp",
    durationSec: 22,
    license: "Service Original (CC0)",
    tags: JSON.stringify(["웅장한", "따뜻한"]),
  },
];

/**
 * 모션 루프 영상 메타데이터 10건을 D1 SQLite 데이터베이스에 시드 (멱등적 실행 보장)
 */
export async function seedBackgrounds(db: DbInstance): Promise<number> {
  for (const item of initialBackgrounds) {
    await db.insert(backgrounds).values(item).onConflictDoNothing();
  }
  return initialBackgrounds.length;
}
