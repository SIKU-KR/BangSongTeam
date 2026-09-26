# 운영 런북: 배경 라이브러리

> **대상**: 서비스 운영자. 평소 등록·삭제는 앱의 배경 화면에서 관리자 계정으로 한다 (3장). 이 런북의 SQL은 대량 등록·복구·관리자 지정에 쓴다.
> **정본**: 아래 SQL은 `src/db/ops/backgroundSql.ts`에 정의되어 있고, `backgroundSql.test.ts`가 실제 마이그레이션 스키마에 대해 실행해 본다. `runbook.test.ts`가 이 문서에 글자 그대로 실려 있는지 확인하므로, **문장을 고칠 때는 두 곳을 함께 고친다.**

배경은 모두 **기본 제공 배경**(`source='service'`)이다. 누구에게나 한 갤러리로 보이고, 공개 덱과 포크에도 따라간다. 사용자 업로드는 없다. 예전 사용자 업로드 행(`source='user'`)은 마이그레이션 `0002_drop_user_backgrounds`가 지웠다.

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

### 1-4. 이미지 배경 포스터 채우기

앱은 이미지 배경을 올릴 때도 폭 960px WebP 포스터를 만들어 `posters/<id>.webp`에 함께 올린다. 그 전에 올라간 이미지 배경은 원본(최대 30MB)을 포스터로도 써서, 배경 갤러리·배경 선택·편집기 슬라이드 썸네일이 모두 원본을 받는다. 이런 배경을 찾는다.

```sql
-- LIST_IMAGE_BACKGROUNDS_WITHOUT_POSTER
SELECT id, title, r2_key, size_bytes FROM backgrounds WHERE source = 'service' AND kind = 'image' AND poster_key = r2_key ORDER BY title;
```

배경마다 원본을 받아 포스터를 만들고, R2에 먼저 올린다. `<id>`는 배경 id, `stills/<id>.jpg`는 위에서 나온 `r2_key`다.

```bash
pnpm dlx wrangler r2 object get prj-ppt-media/stills/<id>.jpg --file ./still.jpg --remote
ffmpeg -i still.jpg -vf "scale='min(960,iw)':-2" -c:v libwebp -quality 80 poster.webp
pnpm dlx wrangler r2 object put prj-ppt-media/posters/<id>.webp \
  --file ./poster.webp --content-type image/webp --remote
```

ffmpeg에 `libwebp`가 없으면 1-1처럼 PNG로 뽑아 `cwebp`로 바꾼다.

그다음 행이 포스터를 가리키게 한다. `:size_bytes`는 원래 `size_bytes`에 포스터 크기를 더한 값이다. 이미 포스터가 있는 행은 바뀌지 않는다.

```sql
-- SET_IMAGE_BACKGROUND_POSTER
UPDATE backgrounds SET poster_key = :poster_key, size_bytes = :size_bytes WHERE id = :background_id AND source = 'service' AND kind = 'image' AND poster_key = r2_key;
```

앱의 배경 목록은 다음 동기화 때 새 포스터를 쓴다. 이 배경을 지울 때는 2장의 R2 삭제에 `posters/<id>.webp`도 넣는다 (앱에서 지우면 서버가 둘 다 지운다).

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

## 3. 앱에서 올리고 지우기 (관리자)

`ADMIN_USER_IDS` 시크릿에 적힌 계정은 앱의 배경 화면에 '배경 올리기'와 카드별 '삭제'가 보인다. 올린 배경은 곧바로 기본 제공 배경이 되어 모든 사용자에게 보인다 (파일당 30MB, 계정 한도 없음). 브라우저가 영상은 첫 화면으로, 이미지는 원본을 줄여 폭 960px 포스터를 만들어 함께 올린다. R2 키는 영상 `loops/<id>.mp4`, 이미지 `stills/<id>.*`, 포스터 `posters/<id>.*`다. 올릴 때는 1장처럼 R2 → D1, 지울 때는 2장처럼 D1 → R2 순서로 서버가 처리한다.

### 3-1. 관리자 지정

관리자는 이메일이 아니라 user id로 지정한다 (이메일은 검증되지 않아 남이 같은 주소로 가입할 수 있다). 관리자로 쓸 계정으로 한 번 로그인한 뒤 id를 찾는다.

```sql
-- FIND_USER_ID_BY_EMAIL
SELECT id, name, email FROM user WHERE email = :email;
```

찾은 id를 쉼표로 이어 시크릿에 넣는다. 로컬은 `.dev.vars`의 `ADMIN_USER_IDS`에 넣는다.

```bash
printf '<user id>,<user id>' | pnpm exec wrangler secret put ADMIN_USER_IDS
pnpm exec wrangler secret delete ADMIN_USER_IDS   # 관리자 없음 (갤러리는 읽기 전용)
```

### 3-2. 예전 사용자 업로드 파일

`0002` 마이그레이션은 D1 행만 지운다. R2의 `uploads/` 아래에 파일이 남아 있으면 지운다. 앱은 이 파일을 더 이상 가리키지 않는다.

```bash
pnpm dlx wrangler r2 object delete prj-ppt-media/uploads/<userId>/<배경 id>.mp4 --remote
```

## 4. 로컬 개발 환경

로컬 D1과 R2는 `.wrangler/state/`에 있다. 새로 받은 코드는 비어 있다.

- 개발자 로그인 계정의 id를 `.dev.vars`의 `ADMIN_USER_IDS`에 넣으면 배경 화면에서 바로 올릴 수 있다 (3-1).
- 사전 주입 배경을 확인하려면 1-2·1-3을 `--local`로 실행한다.
- `0001_initial.sql`이 바뀌면(첫 배포 전 스키마 정리) 이미 적용된 로컬 DB에는 다시 적용되지 않는다. `.wrangler/state/v3/d1`을 지우고 `pnpm db:migrate:local`을 다시 돌린다.
