-- 사전 주입 모션 루프 배경 10건 (PRD 6.3 / M0 산출물).
--
-- 이 행들이 없으면 `decks.background_id` 외래키 때문에 곡이 담긴 프레젠테이션을
-- 저장할 수 없다. D1은 SQLite와 달리 외래키를 기본으로 강제하므로, 배경이 붙은
-- 덱을 insert하는 순간 배치 전체가 롤백되고 동기화가 500으로 죽는다.
-- 그래서 시드를 별도 스크립트가 아니라 마이그레이션으로 둔다 — 로컬과 운영이
-- 같은 명령(`db:migrate:local` / `db:migrate:prod`)으로 반드시 함께 채워진다.
--
-- 값의 정본은 `packages/shared/src/constants/backgrounds.ts`의 INITIAL_BACKGROUNDS다.
-- 두 곳이 갈라지지 않도록 `packages/db/src/seed/backgrounds.test.ts`가 대조한다.
INSERT OR IGNORE INTO backgrounds (id, title, r2_key, poster_key, duration_sec, license, tags) VALUES
  ('b0000000-0000-0000-0000-000000000001', '은은한 빛의 흐름', 'loops/warm_light_flow.mp4', 'posters/warm_light_flow.webp', 20, 'Service Original (CC0)', '["잔잔한","따뜻한"]'),
  ('b0000000-0000-0000-0000-000000000002', '고요한 호수 물결', 'loops/calm_lake_waves.mp4', 'posters/calm_lake_waves.webp', 24, 'Service Original (CC0)', '["잔잔한","차가운"]'),
  ('b0000000-0000-0000-0000-000000000003', '깊은 밤의 별빛', 'loops/night_starlight.mp4', 'posters/night_starlight.webp', 30, 'Service Original (CC0)', '["잔잔한","어두운"]'),
  ('b0000000-0000-0000-0000-000000000004', '아침 햇살의 광채', 'loops/morning_sunlight.mp4', 'posters/morning_sunlight.webp', 18, 'Service Original (CC0)', '["밝은","따뜻한"]'),
  ('b0000000-0000-0000-0000-000000000005', '푸른 하늘 구름', 'loops/blue_sky_clouds.mp4', 'posters/blue_sky_clouds.webp', 22, 'Service Original (CC0)', '["밝은","차가운"]'),
  ('b0000000-0000-0000-0000-000000000006', '새벽 미명의 안개', 'loops/dawn_mist.mp4', 'posters/dawn_mist.webp', 25, 'Service Original (CC0)', '["밝은","어두운"]'),
  ('b0000000-0000-0000-0000-000000000007', '타오르는 영광의 불꽃', 'loops/glory_fire.mp4', 'posters/glory_fire.webp', 16, 'Service Original (CC0)', '["웅장한","따뜻한"]'),
  ('b0000000-0000-0000-0000-000000000008', '장엄한 푸른 파도', 'loops/majestic_ocean.mp4', 'posters/majestic_ocean.webp', 20, 'Service Original (CC0)', '["웅장한","차가운"]'),
  ('b0000000-0000-0000-0000-000000000009', '광활한 은하수 공간', 'loops/cosmic_galaxy.mp4', 'posters/cosmic_galaxy.webp', 30, 'Service Original (CC0)', '["웅장한","어두운"]'),
  ('b0000000-0000-0000-0000-000000000010', '찬란한 빛의 기둥', 'loops/radiant_pillars.mp4', 'posters/radiant_pillars.webp', 22, 'Service Original (CC0)', '["웅장한","따뜻한"]');
