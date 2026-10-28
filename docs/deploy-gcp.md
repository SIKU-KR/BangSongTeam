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
gcloud firestore databases create --location="$REGION" --type=firestore-native
```

Firestore 규칙(`firestore.rules`)은 브라우저 접근을 모두 막는다. 서버는 서비스 계정 자격이라
규칙을 거치지 않는다. 검색에 쓰는 복합 색인은 `firestore.indexes.json`에 있고 CI가 배포한다.
처음 배포하면 색인이 만들어지는 몇 분 동안 공유 라이브러리 검색이 실패할 수 있다.

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
`proxy-secret`은 Cloudflare Worker의 `PROXY_SECRET`에도 같은 값으로 넣는다
(`infra/cloudflare-proxy/wrangler.jsonc`). 두 값이 다르면 서버가 `proxy_secret_mismatch`
경고를 남기고, 모든 사용자가 로그인 빈도 제한 하나를 나눠 쓴다.

## 5. 첫 배포 (서비스 설정)

서비스 설정은 여기서 한 번 정한다. CI는 이미지만 바꾼다.

```bash
IMAGE=${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:initial
gcloud builds submit --tag "$IMAGE"
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" \
  --service-account "$RUN_SA" --allow-unauthenticated \
  --timeout=3600 --cpu=1 --memory=2Gi \
  --set-env-vars "MEDIA_BUCKET=$BUCKET,BETTER_AUTH_URL=https://bangsongteam.siku-labs.com,KAKAO_CLIENT_ID=<id>,NAVER_CLIENT_ID=<id>,GOOGLE_CLIENT_ID=<id>" \
  --set-secrets "BETTER_AUTH_SECRET=better-auth-secret:latest,KAKAO_CLIENT_SECRET=kakao-client-secret:latest,NAVER_CLIENT_SECRET=naver-client-secret:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest,PROXY_SECRET=proxy-secret:latest"
```

- `--timeout=3600`: 오프라인 송출용 배경 영상(수백 MB)을 느린 회선으로 받아도 끊기지 않게 한다.
- 컨테이너는 `MEDIA_BUCKET`·`BETTER_AUTH_URL`·`BETTER_AUTH_SECRET`·`PROXY_SECRET` 중 하나라도
  비어 있으면 뜨지 않는다(`scripts/cloudRunBoot.mjs`). 나중에 바꿀 때 `--set-env-vars`·`--set-secrets`는
  나머지 변수·비밀값을 모두 지우므로 `--update-env-vars`·`--update-secrets`를 쓴다.
- 사용하지 않는 소셜 로그인은 id·secret을 빼면 로그인 화면에서 사라진다.
- 서울 리전은 Cloud Run 도메인 매핑을 지원하지 않아, 도메인은 Cloudflare Worker 프록시
  (`infra/cloudflare-proxy`)가 run.app으로 넘긴다. Worker와 Cloud Run에 같은 `PROXY_SECRET`을
  넣어야 서버가 프록시가 넘긴 사용자 IP를 믿는다.

## 6. GitHub Actions (Workload Identity Federation)

```bash
gcloud iam service-accounts create github-deployer
DEPLOY_SA=github-deployer@${PROJECT_ID}.iam.gserviceaccount.com
for role in roles/run.admin roles/artifactregistry.writer roles/firebaserules.admin roles/datastore.indexAdmin \
  roles/firebase.viewer roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOY_SA" --role="$role"
done
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser

gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers create-oidc github --location=global \
  --workload-identity-pool=github --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
  --attribute-condition="assertion.repository=='SIKU-KR/BangSongTeam'"
POOL=$(gcloud iam workload-identity-pools describe github --location=global --format='value(name)')
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL}/attribute.repository/SIKU-KR/BangSongTeam"
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

## 8. 회원 탈퇴

탈퇴 요청은 본인 확인 뒤 `scripts/deleteUser.mjs <사용자 id> --target=remote`로 지울 데이터를 세고
`--apply`를 붙여 지운다. 순서와 남기는 것은 그 파일 머리말에 있다.
