# 운영 런북: 배포

> **대상**: 서비스 운영자
> **배포 경로**: GitHub Actions(`.github/workflows/ci-cd.yml`)가 한다. main에 머지하면 검증 → D1 마이그레이션 → Worker 배포 순서로 돈다. 로컬 `wrangler deploy`는 쓰지 않는다.

## 0. 운영 구성

| 항목      | 값                                                                                       |
| --------- | ---------------------------------------------------------------------------------------- |
| Worker    | `prj-ppt-web`                                                                            |
| 주소      | `https://prj-ppt-web.peter012677.workers.dev` (도메인을 사기 전까지 쓰는 임시 주소)      |
| D1        | `prj-ppt-db`, APAC. 옛 스키마가 남아 있어 2026-09-24에 새로 만들었다                     |
| R2        | `prj-ppt-media`                                                                          |
| 오류 로그 | Workers Logs (`wrangler.jsonc`의 `observability`). 대시보드 Workers → prj-ppt-web → Logs |

`BETTER_AUTH_URL`은 시크릿이 아니라 `wrangler.jsonc`의 `vars`에 있다. 주소를 바꿀 때는 코드와 함께 머지한다.

## 1. 최초 1회: CI 자격증명

1. Cloudflare 대시보드 → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** 템플릿을 고른다.
2. 권한에 **Account · D1 · Edit**를 추가한다 (템플릿에 없다. 빠지면 마이그레이션 단계가 실패한다).
3. Account Resources는 이 계정 하나로 좁힌다.
4. GitHub 저장소 Settings → Secrets and variables → Actions에 두 값을 넣는다.
   - `CLOUDFLARE_API_TOKEN`: 방금 만든 토큰
   - `CLOUDFLARE_ACCOUNT_ID`: `pnpm exec wrangler whoami`가 보여 주는 Account ID

CLI로 넣으려면 토큰을 클립보드에 복사한 뒤 실행한다. 토큰이 터미널 기록에 남지 않는다.

```bash
pbpaste | gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID --body "<Account ID>"
```

넣은 뒤 실패한 main 실행을 다시 돌린다: Actions → CI/CD → Re-run failed jobs (또는 `gh workflow run ci-cd.yml --ref main`).

## 2. Worker 시크릿

| 이름                                      | 값                   | 비고                                                  |
| ----------------------------------------- | -------------------- | ----------------------------------------------------- |
| `BETTER_AUTH_SECRET`                      | 무작위 32자 이상     | 2026-09-24 설정됨. 바꾸면 모든 로그인 세션이 끊긴다   |
| `KAKAO_CLIENT_ID` / `KAKAO_CLIENT_SECRET` | 카카오 콘솔 발급값   | 비어 있으면 로그인 화면에 카카오 버튼이 나오지 않는다 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 네이버 콘솔 발급값   | 위와 같다                                             |
| `DEV_LOGIN_ENABLED`                       | **절대 넣지 않는다** | 켜지면 누구나 아무 계정으로 로그인할 수 있다          |
| `EMAIL_SIGNUP_ALLOWLIST`                  | 가입을 허용할 이메일 | 쉼표로 구분. 비어 있으면 이메일 로그인이 꺼진다 (2.1) |

값을 표준 입력으로 넘겨 화면에 남기지 않는다. 시크릿을 바꾸면 Worker 새 버전이 곧바로 배포된다.

```bash
openssl rand -base64 48 | tr -d '\n' | pnpm exec wrangler secret put BETTER_AUTH_SECRET
pbpaste | pnpm exec wrangler secret put KAKAO_CLIENT_ID
pnpm exec wrangler secret list
```

### 2.1 이메일·비밀번호 로그인

카카오·네이버를 붙이기 전까지 쓰는 로그인이다. 메일 인증이 없으므로 `EMAIL_SIGNUP_ALLOWLIST`에 적힌 주소만 로그인 화면의 "가입" 탭으로 가입할 수 있다. Better Auth의 공개 가입 경로(`/api/auth/sign-up/email`)는 항상 닫혀 있다. 이메일은 개인정보라 `vars`가 아니라 시크릿으로 넣는다.

```bash
printf 'me@example.com,team@example.com' | pnpm exec wrangler secret put EMAIL_SIGNUP_ALLOWLIST
pnpm exec wrangler secret delete EMAIL_SIGNUP_ALLOWLIST   # 이메일 로그인 끄기 (이미 가입한 계정도 로그인할 수 없게 된다)
```

- **목록에서 빼도 이미 가입한 계정은 남는다.** 목록은 가입만 막는다. 계정을 없애려면 D1에서 해당 `user` 행을 지운다.
- **소셜 로그인과 자동으로 합쳐지지 않는다.** 비밀번호 계정은 이메일 미인증 상태라, 같은 이메일로 카카오·네이버 로그인을 하면 "account not linked"로 실패한다(계정 선점 방지). 소셜 로그인을 붙인 뒤에는 그 사람의 비밀번호 계정을 지우고 소셜로 다시 가입하게 한다.
- **CPU 한도.** 비밀번호 해시는 Workers Free의 요청당 CPU 10ms 한도에 맞춰 PBKDF2-SHA256 100,000회(`src/worker/lib/password.ts`)다. 대시보드 Workers → prj-ppt-web → Logs에서 `/api/auth/sign-in/email`, `/api/email-signup` 요청의 CPU 시간과 `exceededCpu`/1102 오류를 본다. 1102가 반복되면 `PBKDF2_ITERATIONS`를 낮추거나(저장된 해시에 횟수가 기록되어 기존 계정은 그대로 검증된다) Workers Paid로 옮긴다.
- 로그인 시도는 Better Auth rate limit(같은 IP에서 10초에 3회)으로 막는다. 저장소가 isolate 메모리라 isolate마다 따로 센다.

## 3. 배포할 때마다

main 머지 → `verify`(typecheck·lint·test·build·dry-run) → `deploy`(build → `pnpm db:migrate:prod` → `wrangler deploy`).

- **마이그레이션이 코드보다 먼저 적용된다.** 배포가 끝날 때까지는 이전 코드가 새 스키마 위에서 돈다. 컬럼은 추가만 하고, 삭제·이름 변경은 코드가 더 이상 쓰지 않게 한 번 배포한 뒤 다음 배포에서 한다.
- 배포 후 확인:

```bash
curl -s https://prj-ppt-web.peter012677.workers.dev/api/health   # {"status":"ok"}
```

- 서비스 워커는 `registerType: "prompt"`라 배포가 송출 중인 화면을 새로고침하지 않는다. 사용자는 편집 화면의 갱신 버튼을 눌러야 새 버전을 받는다.

## 4. 되돌리기

Worker는 직전 버전으로 되돌린다. D1 마이그레이션은 되돌려지지 않으므로, 되돌린 코드가 새 스키마에서 도는지 먼저 본다.

```bash
pnpm exec wrangler deployments list
pnpm exec wrangler rollback            # 직전 버전, 또는 rollback <version-id>
```

D1은 Time Travel로 특정 시점으로 복원한다 (무료 플랜 7일, 유료 30일). **복원은 그 시점 이후의 쓰기를 모두 지운다.**

```bash
pnpm exec wrangler d1 time-travel info prj-ppt-db
pnpm exec wrangler d1 time-travel restore prj-ppt-db --timestamp=<ISO-8601>
```

## 5. 도메인 연결 (도메인을 산 뒤)

1. 도메인을 Cloudflare 존으로 추가하고 등록업체에서 네임서버를 바꾼다.
2. `wrangler.jsonc`를 고친다. workers.dev를 끄는 이유: 출처가 둘이면 PWA 캐시·IndexedDB·로그인 쿠키가 둘로 갈린다.

```jsonc
"routes": [{ "pattern": "<도메인>", "custom_domain": true }],
"workers_dev": false,
"vars": { "BETTER_AUTH_URL": "https://<도메인>" }
```

3. 카카오·네이버 콘솔의 사이트 도메인과 Redirect URI를 새 도메인으로 바꾼다 (6장).
4. API 토큰의 Zone Resources에 새 존을 넣는다. 배포가 권한 오류로 실패하면 그 존에 **Zone · DNS · Edit**를 더한다.
5. main에 머지하면 CI가 도메인을 붙여 배포한다. DNS 레코드와 인증서는 Cloudflare가 만든다.

## 6. 카카오·네이버 로그인 연결

Redirect URI는 `https://<주소>/api/auth/callback/kakao`, `https://<주소>/api/auth/callback/naver`다. `<주소>`는 `BETTER_AUTH_URL`과 같아야 한다.

- **카카오** (developers.kakao.com): 앱 만들기 → 플랫폼 Web에 사이트 도메인 등록 → 카카오 로그인 활성화 → Redirect URI 등록 → 동의항목에 닉네임·프로필 사진 → Client Secret 발급·활성화. REST API 키가 `KAKAO_CLIENT_ID`, Client Secret이 `KAKAO_CLIENT_SECRET`이다. 이메일은 비즈 앱 심사를 통과해야 내려오고, 없으면 서버가 계정 식별용 주소를 만들어 넣는다.
- **네이버** (developers.naver.com): 애플리케이션 등록 → 네이버 로그인 API → 서비스 URL과 Callback URL 등록 → 제공 정보에 이름·별명·프로필 사진·이메일. 검수 전에는 멤버 관리에 등록한 아이디만 로그인할 수 있다.

두 값을 2장처럼 시크릿으로 넣으면 로그인 화면에 버튼이 바로 나온다. 외부 교회에 열기 전에 이용약관·개인정보처리방침 페이지가 필요하다 (아직 없다).
