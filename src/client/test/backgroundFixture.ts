import type { BackgroundMedia, Presentation } from "#shared";

/** 테스트용 배경. id는 21자 NanoID 형식을 지킨다 */
export function makeBackground(
  index: number,
  overrides: Partial<BackgroundMedia> = {},
): BackgroundMedia {
  const id = `bg${String(index).padStart(19, "0")}`;
  return {
    id,
    title: `배경 ${index}`,
    source: "service",
    kind: "video",
    mediaUrl: `/api/media/loops/${id}.mp4`,
    posterUrl: `/api/media/posters/${id}.webp`,
    durationSec: 20,
    sizeBytes: 1_000_000,
    license: "Service Original (CC0)",
    tags: ["잔잔한"],
    createdAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

export const TEST_SERVICE_BACKGROUNDS: BackgroundMedia[] = [1, 2, 3, 4, 5].map(
  (index) => makeBackground(index),
);

/** 세트의 곡마다 배경을 순서대로 입힌다 (`null`은 배경 없음) */
export function withBackgrounds(
  presentation: Presentation,
  backgroundIds: (string | null)[],
): Presentation {
  return {
    ...presentation,
    items: presentation.items.map((item, index) =>
      item.deck
        ? {
            ...item,
            deck: {
              ...item.deck,
              backgroundId: backgroundIds[index % backgroundIds.length],
            },
          }
        : item,
    ),
  };
}
