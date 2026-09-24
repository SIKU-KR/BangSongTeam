# 운영 런북: 배경 라이브러리

> **대상**: 서비스 운영자 (관리자 화면은 두지 않는다)
> **정본**: 아래 SQL은 `src/db/ops/backgroundSql.ts`에 정의되어 있고, `backgroundSql.test.ts`가 실제 마이그레이션 스키마에 대해 실행해 본다. `runbook.test.ts`가 이 문서에 글자 그대로 실려 있는지 확인하므로, **문장을 고칠 때는 두 곳을 함께 고친다.**

배경은 두 종류다.

- **사전 주입 배경** (`source='service'`): 운영자가 이 런북으로 등록한다. 누구에게나 보이고, 공개 덱과 포크에도 따라간다.
- **사용자 커스텀 배경** (`source='user'`): 사용자가 배경 라이브러리 화면에서 직접 올린다. 소유자 본인만 쓰고, 공개 덱·포크에서는 '배경 없음'으로 보인다.

첫 마이그레이션(`0001_initial`)은 배경 행을 넣지 않는다. 예전에는 R2에 없는 파일을 가리키는 시드 10건이 들어가 편집기·송출이 깨진 배경을 그렸다. **배경 행은 R2 객체가 올라간 뒤에만 만든다.**

## 0. 실행 방법

D1 원격 DB에 SQL 한 문장을 실행한다.

```bash
pnpm dlx wrangler d1 execute prj-ppt-db --remote --command "<SQL>"
```

- 로컬 개발 환경(`pnpm dev`)에 넣으려면 `--remote`를 `--local`로 바꾼다. R2 명령도 같다.
- `wrangler d1 execute --command`는 바인딩 파라미터를 받지 않는다. 문장 안의 `:name` 자리표시자를 **작은따옴표로 감싼 값**으로 바꿔 넣는다. 값에 작은따옴표가 있으면 두 번 쓴다 (`'주님''의'`). 숫자(`:duration_sec`, `:size_bytes`)는 따옴표 없이 쓴다.
- 변경 문장은 실행 전에 같은 `WHERE` 조건으로 `SELECT`를 먼저 돌려 대상이 맞는지 본다.

## 1. 사전 주입 배경 등록

### 1-1. 파일 준비 (PRD 6.3)

1920×1080, 10~30초 무음 루프, H.264 MP4, 20MB 이하. 포스터는 첫 화면 WebP다.

```bash
ffmpeg -i source.mov -an -c:v libx264 -profile:v high -pix_fmt yuv420p \
  -vf scale=1920:1080 -crf 23 -movflags +faststart warm_light_flow.mp4
ffmpeg -ss 1 -i warm_light_flow.mp4 -frames:v 1 -vf scale=960:-2 \
  -c:v libwebp -quality 80 warm_light_flow.webp
```

ffmpeg에 WebP 인코더(`libwebp`)가 없으면 PNG로 뽑은 뒤 `cwebp`로 바꾼다. JPEG 포스터(`image/jpeg`)도 된다.

```bash
ffmpeg -ss 1 -i warm_light_flow.mp4 -frames:v 1 -vf scale=960:-2 poster.png
cwebp -q 80 poster.png -o warm_light_flow.webp
```

재배포가 허용된 라이선스인지 먼저 확인한다 (PRD 9장). 확인되지 않으면 올리지 않는다.

### 1-2. R2에 먼저 올린다

`--content-type`을 빠뜨리지 않는다. 미디어 프록시(`/api/media/*`)는 R2 객체에 저장된 형식을 그대로 응답하므로, 빠지면 `<video>`가 재생하지 못할 수 있다.

```bash
pnpm dlx wrangler r2 object put prj-ppt-media/loops/warm_light_flow.mp4 \
  --file ./warm_light_flow.mp4 --content-type video/mp4 --remote
pnpm dlx wrangler r2 object put prj-ppt-media/posters/warm_light_flow.webp \
  --file ./warm_light_flow.webp --content-type image/webp --remote
```

올라갔는지 확인한다. 배포된 앱에서 `https://<도메인>/api/media/loops/warm_light_flow.mp4`가 재생되어야 한다.

### 1-3. D1에 등록한다

id는 21자 NanoID로 새로 만든다. `size_bytes`는 영상과 포스터 크기의 합이다.

```bash
node -e "import('nanoid').then(({ nanoid }) => console.log(nanoid()))"
stat -f%z warm_light_flow.mp4 warm_light_flow.webp   # Linux: stat -c%s
```

```sql
-- REGISTER_SERVICE_BACKGROUND
INSERT INTO backgrounds (id, title, r2_key, poster_key, duration_sec, license, tags, source, kind, size_bytes) VALUES (:id, :title, :r2_key, :poster_key, :duration_sec, :license, :tags, 'service', 'video', :size_bytes);
```

- `:tags`는 JSON 배열 문자열이다. 분위기(잔잔한·밝은·웅장한) 하나와 주조색(따뜻한·차가운·어두운) 하나를 붙인다. 예: `'["잔잔한","따뜻한"]'`
- `:license`에는 출처와 라이선스를 적는다. 예: `'Service Original (CC0)'`, `'Pexels License — 작가명'`

등록 결과를 확인한다. 앱의 배경 라이브러리 '기본 제공 배경'에도 바로 나온다 (다음 동기화 때).

```sql
-- LIST_SERVICE_BACKGROUNDS
SELECT id, title, r2_key, poster_key, duration_sec, size_bytes, tags FROM backgrounds WHERE source = 'service' ORDER BY title;
```

## 2. 사전 주입 배경 내리기

라이선스 문제 등으로 내려야 할 때 쓴다. 먼저 몇 곡이 쓰고 있는지 본다.

```sql
-- COUNT_DECKS_USING_BACKGROUND
SELECT count(*) AS decks FROM decks WHERE background_id = :background_id;
```

행을 지우면 그 배경을 쓰던 곡은 외래키(`ON DELETE SET NULL`)로 '배경 없음'이 된다. 사용자 기기의 오프라인 캐시에는 남아 있을 수 있으나 다음 동기화부터 목록에서 빠진다.

```sql
-- DELETE_SERVICE_BACKGROUND
DELETE FROM backgrounds WHERE id = :background_id AND source = 'service';
```

그다음 R2 객체를 지운다. **순서를 바꾸지 않는다** — 파일부터 지우면 그사이 송출 중인 교회의 배경이 꺼진다.

```bash
pnpm dlx wrangler r2 object delete prj-ppt-media/loops/warm_light_flow.mp4 --remote
pnpm dlx wrangler r2 object delete prj-ppt-media/posters/warm_light_flow.webp --remote
```

## 3. 사용자 커스텀 배경

사용자는 앱에서 직접 올리고 지운다 (파일 30MB·계정 300MB, 권리 확인 동의 필수). R2 키는 `uploads/<userId>/<배경 id>.*`다. 운영자가 할 일은 저장 용량을 살피고, 신고가 들어오면 게시 중단하는 것뿐이다.

계정별 사용량:

```sql
-- LIST_USER_STORAGE
SELECT owner_user_id, count(*) AS files, SUM(size_bytes) AS bytes FROM backgrounds WHERE source = 'user' GROUP BY owner_user_id ORDER BY bytes DESC;
```

권리 침해·부적절한 업로드의 게시 중단 (PRD 4.3). 행을 지우고, 돌려받은 두 키로 R2 객체도 지운다 (이미지는 두 키가 같다).

```sql
-- TAKEDOWN_USER_BACKGROUND
DELETE FROM backgrounds WHERE id = :background_id AND source = 'user' RETURNING r2_key, poster_key;
```

```bash
pnpm dlx wrangler r2 object delete prj-ppt-media/<r2_key> --remote
pnpm dlx wrangler r2 object delete prj-ppt-media/<poster_key> --remote
```

## 4. 로컬 개발 환경

로컬 D1과 R2는 `.wrangler/state/`에 있다. 새로 받은 코드는 비어 있다.

- 커스텀 배경은 앱에서 개발자 로그인 후 배경 라이브러리에서 올리면 된다.
- 사전 주입 배경을 확인하려면 1-2·1-3을 `--local`로 실행한다.
- `0001_initial.sql`이 바뀌면(첫 배포 전 스키마 정리) 이미 적용된 로컬 DB에는 다시 적용되지 않는다. `.wrangler/state/v3/d1`을 지우고 `pnpm db:migrate:local`을 다시 돌린다.
