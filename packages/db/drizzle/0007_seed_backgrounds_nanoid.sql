-- 사전 주입 모션 루프 배경 10건을 NanoID로 다시 넣는다 (2026-09-24).
--
-- 0002_seed_backgrounds가 넣은 UUID 행은 0006_nanoid_reset이 지웠다. 영상과
-- 포스터(R2 키)는 그대로이고 id만 바뀐다.
--
-- 이 행들이 없으면 `decks.background_id` 외래키 때문에 배경이 붙은 곡을 저장할 수
-- 없다 (D1은 외래키를 강제한다). 그래서 시드를 마이그레이션으로 둔다.
--
-- 값의 정본은 `packages/shared/src/constants/backgrounds.ts`의 INITIAL_BACKGROUNDS다.
-- 두 곳이 갈라지지 않도록 `packages/db/src/seed/backgrounds.test.ts`가 대조한다.
INSERT OR IGNORE INTO backgrounds (id, title, r2_key, poster_key, duration_sec, license, tags) VALUES
  ('mJIToShuKOc3FsbZIihi6', '은은한 빛의 흐름', 'loops/warm_light_flow.mp4', 'posters/warm_light_flow.webp', 20, 'Service Original (CC0)', '["잔잔한","따뜻한"]'),
  ('VYMY2lcaf-sSYd8Z1kSmS', '고요한 호수 물결', 'loops/calm_lake_waves.mp4', 'posters/calm_lake_waves.webp', 24, 'Service Original (CC0)', '["잔잔한","차가운"]'),
  ('Z3pQ9LTe8iF6c1WabFlqw', '깊은 밤의 별빛', 'loops/night_starlight.mp4', 'posters/night_starlight.webp', 30, 'Service Original (CC0)', '["잔잔한","어두운"]'),
  ('8UCf1VBmP1pMgdSQ0cUCp', '아침 햇살의 광채', 'loops/morning_sunlight.mp4', 'posters/morning_sunlight.webp', 18, 'Service Original (CC0)', '["밝은","따뜻한"]'),
  ('9Za1L0TVfQscdGPYbnYBf', '푸른 하늘 구름', 'loops/blue_sky_clouds.mp4', 'posters/blue_sky_clouds.webp', 22, 'Service Original (CC0)', '["밝은","차가운"]'),
  ('rQReeyGx9wxCVNvKgWpNd', '새벽 미명의 안개', 'loops/dawn_mist.mp4', 'posters/dawn_mist.webp', 25, 'Service Original (CC0)', '["밝은","어두운"]'),
  ('AuLU_pxDZUXM3B6zeXfnR', '타오르는 영광의 불꽃', 'loops/glory_fire.mp4', 'posters/glory_fire.webp', 16, 'Service Original (CC0)', '["웅장한","따뜻한"]'),
  ('4EoK1yX6-2zKmjWDiONlL', '장엄한 푸른 파도', 'loops/majestic_ocean.mp4', 'posters/majestic_ocean.webp', 20, 'Service Original (CC0)', '["웅장한","차가운"]'),
  ('qkBIjmJg_eb2xSGRnHtqP', '광활한 은하수 공간', 'loops/cosmic_galaxy.mp4', 'posters/cosmic_galaxy.webp', 30, 'Service Original (CC0)', '["웅장한","어두운"]'),
  ('my-K4dh_hYkfUCJEXkopI', '찬란한 빛의 기둥', 'loops/radiant_pillars.mp4', 'posters/radiant_pillars.webp', 22, 'Service Original (CC0)', '["웅장한","따뜻한"]');
