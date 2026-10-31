# Google Cloud 배포 설정

앱은 Cloud Run 서비스 하나(Next.js standalone 컨테이너)로 돌고, 데이터는 Firestore(Native
모드), 배경 영상·포스터는 Cloud Storage 버킷에 둔다. `main`에 머지하면 CI가 이미지를 빌드해
Artifact Registry에 올리고, Firestore 규칙·색인을 배포한 뒤 Cloud Run에 새 이미지를 올린다.
아래는 처음 한 번만 하는 준비다. 예시 값(`asia-northeast3`, `bangsongteam`)은 바꿔도 된다.

```bash
PROJECT_ID=<Firebase 프로젝트 id>
REGION=asia-northeast3
SERVICE=bangsongteam
BUCKET=${PROJECT_ID}-media
REPO=bangsongteam
gcloud config set project "$PROJECT_ID"
```

## 1. API와 Firestore

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com firebaserules.googleapis.com storage.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com cloudbuild.googleapis.com
gcloud firestore databases create --location="$REGION" --type=firestore-native \
  --enable-pitr --delete-protection
gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14d
```

`--enable-pitr`은 최근 7일 안의 분 단위 시점으로, 일일 백업은 14일 안의 하루 단위로 되돌릴 수 있게
한다. 앱의 삭제는 영구 삭제이고 다른 기기의 사본도 삭제 기록을 따라 지워지므로, 사고를 되돌릴 방법은
이 둘뿐이다. `--delete-protection`은 데이터베이스를 통째로 지우는 명령을 막는다. 복구는 10절을
따른다.

이미 만든 데이터베이스에는 한 번만 켜고 백업 일정을 만든다. 그 뒤 `describe`의
`pointInTimeRecoveryEnablement`와 `deleteProtectionState`가 `ENABLED`로 끝나는지, `schedules list`에
일정이 있는지 본다.

```bash
gcloud firestore databases update --database='(default)' --enable-pitr --delete-protection
gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14d
gcloud firestore databases describe --database='(default)'
gcloud firestore backups schedules list --database='(default)'
```

Firestore 규칙(`firestore.rules`)은 브라우저 접근을 모두 막는다. 서버는 서비스 계정 자격이라
규칙을 거치지 않는다. 복합 색인은 `firestore.indexes.json`에 있고 CI가 배포한다.

## 2. 미디어 버킷과 이미지 저장소

```bash
gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access
gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION"
```

배경은 `/api/media/*`가 같은 출처로 흘려보내므로 버킷을 공개할 필요가 없다.

## 3. 서비스 계정

```bash
gcloud iam service-accounts create bangsongteam-run
RUN_SA=bangsongteam-run@${PROJECT_ID}.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUN_SA" --role=roles/datastore.user
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$RUN_SA" --role=roles/storage.objectViewer
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUN_SA" --role=roles/secretmanager.secretAccessor
```

## 4. 비밀값

```bash
printf '%s' "$(openssl rand -base64 32)" | gcloud secrets create better-auth-secret --data-file=-
printf '%s' "$(openssl rand -base64 32)" | gcloud secrets create proxy-secret --data-file=-
printf '%s' '<카카오 secret>' | gcloud secrets create kakao-client-secret --data-file=-
printf '%s' '<네이버 secret>' | gcloud secrets create naver-client-secret --data-file=-
printf '%s' '<구글 secret>' | gcloud secrets create google-client-secret --data-file=-
```

`BETTER_AUTH_SECRET`을 Cloudflare 때와 같은 값으로 두면 이전 뒤에도 기존 로그인 쿠키가 유효하다.
`proxy-secret`은 Cloudflare Worker의 `PROXY_SECRET`에도 같은 값으로 넣는다(9절,
`infra/cloudflare-proxy/wrangler.jsonc`). 두 값이 다르면 서버가 `proxy_secret_mismatch`
경고를 남기고, 모든 사용자가 로그인 빈도 제한 하나를 나눠 쓴다.

서비스는 비밀값을 `:latest`가 아니라 버전 번호로 참조한다. 환경 변수로 받은 비밀값은 인스턴스가 뜰
때 한 번 읽히므로, `latest`면 새 버전을 추가하는 순간부터 같은 리비전의 새 인스턴스와 기존 인스턴스가
다른 값을 쓴다. 로그인 쿠키 서명이 인스턴스마다 달라져 사용자가 로그아웃되고 로그인이 되풀이된다.

교체할 때는 새 버전을 추가하고 그 번호로 새 리비전을 만든다. 모든 인스턴스가 함께 바뀐다.

```bash
printf '%s' "$(openssl rand -base64 32)" | gcloud secrets versions add proxy-secret --data-file=-
gcloud run services update "$SERVICE" --region "$REGION" --update-secrets PROXY_SECRET=proxy-secret:<새 번호>
```

- `BETTER_AUTH_SECRET`을 바꾸면 모든 사용자가 로그아웃된다.
- `PROXY_SECRET`은 Cloud Run을 바꾼 직후 Worker에도 같은 값을 넣는다(9절). 그 사이에는 서버가
  프록시가 넘긴 사용자 IP를 믿지 않는다. `REQUIRE_PROXY`를 켰다면 그 사이 API가 모두 403이 되고,
  앱은 403을 다시 보내지 않아 그동안 한 편집이 동기화 실패로 남는다. 그래서 플래그를 끄는 명령에서
  비밀값을 바꾸고, Worker에 같은 값을 넣은 뒤 9절대로 다시 켠다.

  ```bash
  gcloud run services update "$SERVICE" --region "$REGION" --remove-env-vars REQUIRE_PROXY \
    --update-secrets PROXY_SECRET=proxy-secret:<새 번호>
  ```

이미 `:latest`로 만든 서비스는 지금 `latest`가 가리키는 번호로 한 번 고정한다. 값이 그대로라
로그아웃되지 않는다. 서비스가 쓰는 비밀값을 모두 적고(쓰지 않는 소셜 로그인의 비밀값은 뺀다),
고정한 뒤 `describe --format=export`의 `secretKeyRef`가 모두 숫자 `key`인지 본다.

```bash
for secret in better-auth-secret proxy-secret google-client-secret kakao-client-secret naver-client-secret; do
  echo "$secret:$(gcloud secrets versions describe latest --secret="$secret" --format='value(name.basename())')"
done
gcloud run services update "$SERVICE" --region "$REGION" --update-secrets \
  BETTER_AUTH_SECRET=better-auth-secret:<번호>,PROXY_SECRET=proxy-secret:<번호>,GOOGLE_CLIENT_SECRET=google-client-secret:<번호>,KAKAO_CLIENT_SECRET=kakao-client-secret:<번호>,NAVER_CLIENT_SECRET=naver-client-secret:<번호>
gcloud run services describe "$SERVICE" --region "$REGION" --format=export
```

## 5. 첫 배포 (서비스 설정)

서비스 설정은 여기서 한 번 정한다. CI는 이미지만 바꾼다.

```bash
IMAGE=${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:initial
gcloud builds submit --tag "$IMAGE"
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" \
  --service-account "$RUN_SA" --allow-unauthenticated \
  --timeout=3600 --cpu=1 --memory=2Gi --max-instances=20 \
  --startup-probe=httpGet.path=/api/health,httpGet.port=8080,periodSeconds=5,timeoutSeconds=3,failureThreshold=24 \
  --set-env-vars "MEDIA_BUCKET=$BUCKET,BETTER_AUTH_URL=https://bangsongteam.siku-labs.com,KAKAO_CLIENT_ID=<id>,NAVER_CLIENT_ID=<id>,GOOGLE_CLIENT_ID=<id>" \
  --set-secrets "BETTER_AUTH_SECRET=better-auth-secret:1,KAKAO_CLIENT_SECRET=kakao-client-secret:1,NAVER_CLIENT_SECRET=naver-client-secret:1,GOOGLE_CLIENT_SECRET=google-client-secret:1,PROXY_SECRET=proxy-secret:1"
```

- `--timeout=3600`: 오프라인 송출용 배경 영상(수백 MB)을 느린 회선으로 받아도 끊기지 않게 한다.
- `--max-instances=20`: 요청이 폭주해도(스크레이핑, 재시도 루프) 인스턴스와 비용이 끝없이 늘지 않게
  상한을 둔다.
- 비밀값은 4절에서 만든 첫 버전(`:1`)으로 고정한다. `:latest`로 두지 않는 까닭과 교체 방법은 4절에 있다.
- 컨테이너는 `MEDIA_BUCKET`·`BETTER_AUTH_URL`·`BETTER_AUTH_SECRET`·`PROXY_SECRET` 중 하나라도
  비어 있으면 뜨지 않는다(`scripts/cloudRunBoot.mjs`). 나중에 바꿀 때 `--set-env-vars`·`--set-secrets`는
  나머지 변수·비밀값을 모두 지우므로 `--update-env-vars`·`--update-secrets`를 쓴다.
- `--startup-probe`: 기본 TCP 프로브는 Next.js가 포트를 열기만 하면 통과해, API 번들에서 빠진
  파일이나 잘못된 환경 변수는 요청을 받아야 드러난다. `/api/health`는 API 번들과 서버 환경을
  불러오므로 이런 리비전은 준비되지 못하고 배포가 실패한다. 이미 만든 서비스에는 한 번 넣는다.

  ```bash
  gcloud run services update "$SERVICE" --region "$REGION" \
    --startup-probe=httpGet.path=/api/health,httpGet.port=8080,periodSeconds=5,timeoutSeconds=3,failureThreshold=24
  ```

- 사용하지 않는 소셜 로그인은 id·secret을 빼면 로그인 화면에서 사라진다.
- 서울 리전은 Cloud Run 도메인 매핑을 지원하지 않아, 도메인은 Cloudflare Worker 프록시가 run.app으로
  넘긴다(9절).
- 지금 서비스에 걸린 설정은 `gcloud run services describe "$SERVICE" --region "$REGION" --format=export`로
  본다. 콘솔에서 바꾼 설정이 이 절과 다르면 이 절을 고친다.

## 6. GitHub Actions (Workload Identity Federation)

공급자는 저장소 전체가 아니라 `main`에서 도는 `ci-cd.yml`의 토큰만 받아들인다. 저장소 전체로 묶으면
`main`에서만 배포한다는 확인이 워크플로 파일 안에 있어서, 다른 브랜치에서 그 파일을 고쳐 돌린 작업도
배포 계정을 받는다. 아래가 그 조건이고, 공급자를 만들 때도 바꿀 때도 쓴다. `gh`가 저장소 id를 읽지
못하면(로그인 전 등) 어떤 토큰도 맞지 않는 조건이 되므로, 그때는 `CONDITION`을 만들지 않는다.

```bash
REPO_ID=$(gh api repos/SIKU-KR/BangSongTeam --jq .id)
[[ $REPO_ID =~ ^[0-9]+$ ]] &&
  CONDITION="assertion.repository_id=='${REPO_ID}' && assertion.ref=='refs/heads/main' && assertion.workflow_ref=='SIKU-KR/BangSongTeam/.github/workflows/ci-cd.yml@refs/heads/main'"
```

```bash
gcloud iam service-accounts create github-deployer
DEPLOY_SA=github-deployer@${PROJECT_ID}.iam.gserviceaccount.com
for role in roles/run.admin roles/artifactregistry.writer roles/firebaserules.admin roles/datastore.indexAdmin \
  roles/firebase.viewer roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOY_SA" --role="$role"
done
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser

gcloud iam workload-identity-pools create github --location=global
: "${CONDITION:?CONDITION이 필요합니다}" &&
  gcloud iam workload-identity-pools providers create-oidc github --location=global \
    --workload-identity-pool=github --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
    --attribute-condition="$CONDITION"
POOL=$(gcloud iam workload-identity-pools describe github --location=global --format='value(name)')
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL}/attribute.repository/SIKU-KR/BangSongTeam"
```

이미 만든 공급자는 같은 조건으로 한 번 바꾼다. 새 셸이면 조건을 만드는 블록을 먼저 실행한다.
`CONDITION`이 비면 조건이 지워지므로 비어 있을 때는 멈춘다. `main`에 푸시하는 배포는 그대로 통과한다.

```bash
: "${CONDITION:?CONDITION이 필요합니다}" &&
  gcloud iam workload-identity-pools providers update-oidc github --location=global \
    --workload-identity-pool=github --attribute-condition="$CONDITION"
```

저장소 Settings → Secrets and variables → Actions → **Variables**에 넣는다.
`GCP_PROJECT_ID`가 비어 있으면 CI는 검증만 하고 배포하지 않는다.

| 변수                             | 값                         |
| -------------------------------- | -------------------------- |
| `GCP_PROJECT_ID`                 | `$PROJECT_ID`              |
| `GCP_REGION`                     | `$REGION`                  |
| `CLOUD_RUN_SERVICE`              | `$SERVICE`                 |
| `ARTIFACT_REPOSITORY`            | `$REPO`                    |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `${POOL}/providers/github` |
| `GCP_DEPLOY_SERVICE_ACCOUNT`     | `$DEPLOY_SA`               |

## 7. Cloudflare 데이터 옮기기

`scripts/migrateFromCloudflare.cloudbuild.yaml`이 Cloud Build 안에서 R2 객체를 버킷으로 복사하고
D1 테이블을 운영 Firestore에 쓴다. 필요한 토큰과 실행 명령은 그 파일 머리말에 있다.

1. 미리보기(`_APPLY_MEDIA`·`_APPLY_FIRESTORE`가 `false`)로 복사할 객체와 옮길 문서 수를 확인한다.
2. 옮기는 동안 생긴 쓰기는 따라오지 않으므로 기존 서비스의 쓰기를 멈추고 `_APPLY_MEDIA=true,_APPLY_FIRESTORE=true`로 돌린다.
3. 도메인을 Cloud Run으로 옮기고 Cloudflare Worker·D1·R2와 `CLOUDFLARE_*` 저장소 비밀값을 정리한다.

도메인을 옮긴 뒤에는 `_APPLY_FIRESTORE`를 다시 켜지 않는다. 새 서비스에서 생긴 쓰기와 게시 중단이 D1의
옛 값으로 돌아가서, Firestore에 사용자가 이미 있으면 스크립트가 멈춘다. 미디어만 다시 복사하려면
`_APPLY_MEDIA`만 켠다.

## 8. 배포 확인과 되돌리기

CI는 새 리비전을 트래픽 없이 `candidate` 태그로 올리고, 태그 주소의 `/api/health`와
`/api/backgrounds`가 응답해야 트래픽을 옮긴다. 확인에 실패하면 트래픽은 이전 리비전에 남고, 실패한
리비전은 태그 주소(`gcloud run services describe`의 `candidate` URL)로 살펴볼 수 있다. 이 주소는 다음
배포가 태그를 옮기거나 `--remove-tags=candidate`로 태그를 뗄 때까지 누구나 열 수 있다.

트래픽을 받은 뒤에 문제가 드러나면 이전 리비전으로 되돌린다. 태그는 마지막으로 올린 리비전에 남아
있으므로, 함께 떼야 문제 리비전이 태그 주소로 열리지 않는다.

```bash
gcloud run revisions list --service "$SERVICE" --region "$REGION"
gcloud run services update-traffic "$SERVICE" --region "$REGION" \
  --to-revisions=<이전 리비전>=100 --remove-tags=candidate
```

다음 CI 배포는 새 리비전에 태그를 다시 붙이고, 확인을 통과하면 트래픽을 다시 최신 리비전으로
옮긴다. 문제를 고치기 전에 다른 PR을 머지하면 문제가 남은 코드로 돌아가므로, 문제 커밋을 되돌리는
PR이나 고친 PR을 먼저 머지한다.

## 9. Cloudflare Worker 프록시

도메인의 모든 요청은 `infra/cloudflare-proxy`의 Worker가 run.app으로 넘긴다. CI가 Worker를 배포하지
않으므로 코드나 설정을 바꾸면 손으로 다시 올린다.

새 프로젝트에서는 `wrangler.jsonc`의 `ORIGIN_HOST`를 `${SERVICE}-<프로젝트 번호>.${REGION}.run.app`으로
바꾼다. 번호는 `gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'`로 본다. Worker와
Cloud Run에 같은 `PROXY_SECRET`을 넣어야 서버가 프록시가 넘긴 사용자 IP를 믿는다.

```bash
pnpm dlx wrangler deploy -c infra/cloudflare-proxy/wrangler.jsonc
gcloud secrets versions access <번호> --secret=proxy-secret \
  | pnpm dlx wrangler secret put PROXY_SECRET -c infra/cloudflare-proxy/wrangler.jsonc
```

**요청 한도.** Worker는 페이지·정적 파일·API·미디어를 가리지 않고 도메인의 모든 요청을 거쳐 Workers 요청
한도를 쓴다. 무료 플랜은 하루 10만 건이고 UTC 0시(한국 시간 오전 9시)에 초기화된다. 넘으면 Cloudflare
오류 1027이 나서 로그인·동기화·새 기기가 그날 내내 막힌다. 운영 계정은 Workers Paid로 올리고
Cloudflare 알림에서 Workers 사용량 알림을 켠다.

**run.app 직접 접근.** run.app 주소로 곧장 들어오는 요청은 Worker와 캐시를 건너뛴다. 막으려면 서비스에
`REQUIRE_PROXY=1`을 넣는다. 켜면 프록시 비밀값이 맞지 않는 `/api` 요청은 403이고, 비밀값 헤더가 없는
`/api/health`만 통과한다(시작 프로브, 배포 확인). 그래서 Worker의 비밀값이 어긋나면 도메인 가동 확인도
실패해 알림이 온다(11절). 페이지와 정적 파일은 막지 않는다. 배포 계정이 후보 리비전 확인에서
`proxy-secret`을 읽을 수 있어야 하고(켜진 서비스에서만 읽는다), 켠 직후 도메인은 200, run.app 주소는
403인지 본다.

```bash
gcloud secrets add-iam-policy-binding proxy-secret \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/secretmanager.secretAccessor
gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars REQUIRE_PROXY=1
curl -s -o /dev/null -w '%{http_code}\n' https://bangsongteam.siku-labs.com/api/backgrounds
curl -s -o /dev/null -w '%{http_code}\n' https://<run.app 주소>/api/backgrounds
```

도메인이 403이면 Worker의 비밀값이 Cloud Run과 다른 것이니 바로 끄고 Worker에 값을 다시 넣는다.

```bash
gcloud run services update "$SERVICE" --region "$REGION" --remove-env-vars REQUIRE_PROXY
```

## 10. 데이터 복구

사용자가 잃은 데이터는 운영 데이터베이스를 덮어쓰지 않고 별도 데이터베이스(`restore-1`)로 복구한 뒤,
그 사용자의 빠진 문서만 옮긴다. 복구본은 둘 중 하나로 만든다.

최근 7일 안의 시점(분 단위)으로 만들 때:

```bash
gcloud firestore databases clone --source-database="projects/$PROJECT_ID/databases/(default)" \
  --snapshot-time=<UTC 분 단위 시각, 예 2026-10-27T01:20:00Z> --destination-database=restore-1
```

일일 백업(14일)으로 만들 때:

```bash
gcloud firestore backups list --location="$REGION" --format='table(name,snapshotTime,state)'
gcloud firestore databases restore --source-backup=<백업 이름> --destination-database=restore-1
```

복구본은 콘솔 Firestore에서 `restore-1`을 골라 열고, 읽어서 옮기는 일회용 스크립트는
`createFirestore({ databaseId: "restore-1" })`로 읽는다.

운영 데이터베이스에는 앱의 쓰기 함수로만 쓴다. 쓰기 함수는 그 사용자가 영구 삭제한 id를 되살리지 않고
`deleted`를 돌려주므로, 스크립트는 옮길 id마다 `driveTombstones`의 기록을 먼저 지운다. 문서 id는 폴더와
프레젠테이션이면 그 id, 보관함 곡이면 `deckTombstoneDocId(곡 id)`이고, 기록의 `userId`가 그 사용자일 때만
지운다. 그다음 폴더는 부모부터 `upsertFolder`, 프레젠테이션은 곡 사본을 모두 담아
`savePresentationChanges`, 보관함 곡은 `upsertDeck`으로 쓰고, 결과가 `saved`가 아니면 멈춘다. 문서를
그대로 복사하면 부모 폴더 보정이 빠진다. 다 쓰면
`gcloud firestore databases delete --database=restore-1`로 복구본을 지운다.

## 11. 알림

`infra/monitoring`에 로그 기반 지표(`metrics/`)와 알림 정책(`policies/`)이 있다. 서버 5xx, 컨테이너
오류·메모리, 클라이언트가 보낸 `server_error` 보고, 프록시 비밀값 불일치
(`proxy_secret_mismatch`), 도메인 가동 확인(`/api/health`)을 이메일로 알리고, 월 예산 알림이 없으면
만든다. 처음 한 번 실행하고, 지표·정책 정의를 바꾸면 다시 실행한다. 지표와 정책은 정의대로 고치고 가동
확인과 예산은 없을 때만 만들어서, 여러 번 실행해도 같은 결과다.

```bash
PROJECT_ID=$PROJECT_ID ALERT_EMAIL=<받을 메일> infra/monitoring/apply.sh
```

메일이 오는지는 `gcloud monitoring uptime update <확인 id> --path=/없는-경로`로 가동 확인을 잠시
실패시켜 보고 `--path=/api/health`로 돌린다. 확인 id는 `gcloud monitoring uptime list-configs`에 있다.

## 12. 회원 탈퇴

탈퇴 요청은 본인 확인 뒤 `scripts/deleteUser.mjs <사용자 id> --target=remote`로 지울 데이터를 세고
`--apply`를 붙여 지운다. 순서와 남기는 것은 그 파일 머리말에 있다.
