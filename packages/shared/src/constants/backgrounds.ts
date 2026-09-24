/**
 * PRD M0/M1 규격 10개 기본 모션 비디오 메타데이터 및 URL 해석 헬퍼
 * 분위기(잔잔한 / 밝은 / 웅장한) × 주조색(따뜻한 / 차가운 / 어두운)
 */
export interface InitialBackground {
  id: string;
  title: string;
  r2Key: string;
  posterKey: string;
  durationSec: number;
  license: string;
  tags: string[];
}

export const INITIAL_BACKGROUNDS: readonly InitialBackground[] = [
  {
    id: "mJIToShuKOc3FsbZIihi6",
    title: "은은한 빛의 흐름",
    r2Key: "loops/warm_light_flow.mp4",
    posterKey: "posters/warm_light_flow.webp",
    durationSec: 20,
    license: "Service Original (CC0)",
    tags: ["잔잔한", "따뜻한"],
  },
  {
    id: "VYMY2lcaf-sSYd8Z1kSmS",
    title: "고요한 호수 물결",
    r2Key: "loops/calm_lake_waves.mp4",
    posterKey: "posters/calm_lake_waves.webp",
    durationSec: 24,
    license: "Service Original (CC0)",
    tags: ["잔잔한", "차가운"],
  },
  {
    id: "Z3pQ9LTe8iF6c1WabFlqw",
    title: "깊은 밤의 별빛",
    r2Key: "loops/night_starlight.mp4",
    posterKey: "posters/night_starlight.webp",
    durationSec: 30,
    license: "Service Original (CC0)",
    tags: ["잔잔한", "어두운"],
  },
  {
    id: "8UCf1VBmP1pMgdSQ0cUCp",
    title: "아침 햇살의 광채",
    r2Key: "loops/morning_sunlight.mp4",
    posterKey: "posters/morning_sunlight.webp",
    durationSec: 18,
    license: "Service Original (CC0)",
    tags: ["밝은", "따뜻한"],
  },
  {
    id: "9Za1L0TVfQscdGPYbnYBf",
    title: "푸른 하늘 구름",
    r2Key: "loops/blue_sky_clouds.mp4",
    posterKey: "posters/blue_sky_clouds.webp",
    durationSec: 22,
    license: "Service Original (CC0)",
    tags: ["밝은", "차가운"],
  },
  {
    id: "rQReeyGx9wxCVNvKgWpNd",
    title: "새벽 미명의 안개",
    r2Key: "loops/dawn_mist.mp4",
    posterKey: "posters/dawn_mist.webp",
    durationSec: 25,
    license: "Service Original (CC0)",
    tags: ["밝은", "어두운"],
  },
  {
    id: "AuLU_pxDZUXM3B6zeXfnR",
    title: "타오르는 영광의 불꽃",
    r2Key: "loops/glory_fire.mp4",
    posterKey: "posters/glory_fire.webp",
    durationSec: 16,
    license: "Service Original (CC0)",
    tags: ["웅장한", "따뜻한"],
  },
  {
    id: "4EoK1yX6-2zKmjWDiONlL",
    title: "장엄한 푸른 파도",
    r2Key: "loops/majestic_ocean.mp4",
    posterKey: "posters/majestic_ocean.webp",
    durationSec: 20,
    license: "Service Original (CC0)",
    tags: ["웅장한", "차가운"],
  },
  {
    id: "qkBIjmJg_eb2xSGRnHtqP",
    title: "광활한 은하수 공간",
    r2Key: "loops/cosmic_galaxy.mp4",
    posterKey: "posters/cosmic_galaxy.webp",
    durationSec: 30,
    license: "Service Original (CC0)",
    tags: ["웅장한", "어두운"],
  },
  {
    id: "my-K4dh_hYkfUCJEXkopI",
    title: "찬란한 빛의 기둥",
    r2Key: "loops/radiant_pillars.mp4",
    posterKey: "posters/radiant_pillars.webp",
    durationSec: 22,
    license: "Service Original (CC0)",
    tags: ["웅장한", "따뜻한"],
  },
] as const;

export const DEFAULT_BACKGROUND_ID = INITIAL_BACKGROUNDS[0].id;

/**
 * backgroundId로부터 비디오 재생 URL(예: /api/media/loops/warm_light_flow.mp4)을 생성
 */
export function getBackgroundMediaUrl(
  backgroundId?: string | null,
  baseUrl = "/api/media",
): string | undefined {
  if (!backgroundId) return undefined;
  const item = INITIAL_BACKGROUNDS.find((bg) => bg.id === backgroundId);
  if (!item) return undefined;
  return `${baseUrl.replace(/\/+$/, "")}/${item.r2Key.replace(/^\/+/, "")}`;
}

/**
 * backgroundId로부터 포스터 이미지 URL(예: /api/media/posters/warm_light_flow.webp)을 생성
 */
export function getBackgroundPosterUrl(
  backgroundId?: string | null,
  baseUrl = "/api/media",
): string | undefined {
  if (!backgroundId) return undefined;
  const item = INITIAL_BACKGROUNDS.find((bg) => bg.id === backgroundId);
  if (!item) return undefined;
  return `${baseUrl.replace(/\/+$/, "")}/${item.posterKey.replace(/^\/+/, "")}`;
}
