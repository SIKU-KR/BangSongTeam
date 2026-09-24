# Goal: [M4-5] Zero-Fetch 불변식 고정 및 문서 정합화

> **2026-09-24 범위 변경**: 발표자 보기(조작 창·청중 창·BroadcastChannel 동기화)는 MVP에서 제거됐다. 송출은 전체화면 `/present/:id/fullscreen` 한 가지다. 이 문서의 발표자 보기 관련 부분은 이력으로 남긴다.

> **2026-09-24 범위 변경 (2)**: 예배 준비 화면이 제거되면서 Zero-Fetch 불변식은 'API·데이터 요청 0건'으로 좁혀졌다. 송출 화면도 배경을 조용히 캐시하므로 `zeroFetch.test.tsx`는 `/api/media/*` GET만 허용하고, 오프라인이면 fetch 0건임을 확인한다. 아래의 `/ready` 경유 오프라인 완주 절차는 이력으로 남긴다.

> **마일스톤**: M4 (오프라인 및 발표자 보기)
> **태스크 번호**: `tasks_5.md`
> **선행 조건**: `docs/tasks/m4/tasks_4.md` 완료 (발표자 보기)
> **목표**: '송출 중 네트워크 요청 0건'을 테스트로 고정하고, M4 구현과 어긋나게 된 PRD·TECH_SPEC·AGENTS 문서를 코드에 맞춘다
> **완료 기준 (DoD)**: 송출 라우트를 마운트해도 `fetch`가 한 번도 호출되지 않고, 문서의 M4 관련 서술이 실제 구현과 일치한다

> **구현 현황 (2026-09-22)**
>
> - Task 5.1~5.4 완료. 전체 **674개 / 88파일 Green**.
> - **헤드리스 Chrome 실검증에서 결함 2건을 찾아 고쳤다** (§4에 절차 기록).
>   1. **송출 창이 아예 열리지 않았다** — `openAudienceWindow()`가 `getScreenDetails()`를 먼저 await했는데, 이 API는 권한 프롬프트가 떠 있는 동안 resolve하지 않는다. 조작자가 프롬프트를 무시하면 영원히 매달린다. 창을 먼저 열고 그 다음 화면을 찾아 `moveTo`/`resizeTo`로 옮기도록 순서를 뒤집었다(`tasks_4.md` Task 4.1).
>   2. **조작 창의 '다음' 미리보기가 조작 바를 덮었다** — `aspect-video`가 창 높이보다 큰 높이를 강제해 블랙아웃·가사 숨기기 버튼이 눌리지 않았다. 상자를 채우고 16:9는 `SlideStage`의 레터박스에 맡기도록 고쳤다(`tasks_4.md` Task 4.3).
> - **M4 완료 기준의 절반을 실제로 확인했다**: 빌드본을 서빙하고 Service Worker를 활성화한 뒤 DevTools 오프라인 상태에서 `/present/:id/fullscreen`을 새로고침해도 앱이 뜨고(navigateFallback), 배경 MP4가 캐시에서 200으로 나오며, 5곡 세트를 끝까지 넘겼다.
> - **보조 모니터 확인은 남아 있다.** 이 환경에는 디스플레이가 없어 폴백 경로만 검증된다.
> - 검증 중 M4 범위 밖 결함 2건을 발견했다(§5).

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **불변식은 문장이 아니라 테스트다**: AGENTS.md §6은 '송출 화면 실행 중 외부 fetch 금지'를 금지 사항으로 적어 두었지만 강제하는 장치가 없었다. 테스트로 고정한다.
2. **문서를 실제와 맞춘다**: `docs/tasks/AGENTS.md` §2.1이 요구하는 대로 '구현 현황'을 사실로 갱신한다. 검증하지 않은 것을 완료로 적지 않는다.
3. **M4 완료 선언은 운영자 검증 뒤에** 한다: 이 컨테이너에서는 보조 모니터도, 실제 네트워크 차단도 확인할 수 없다. 절차만 남기고 마일스톤은 '코드 완료'로 표기한다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 5.1: 송출 라우트 Zero-Fetch 회귀 테스트**
  - **대상 파일**: `src/client/routes/zeroFetch.test.tsx`
  - **선행 조건**: `tasks_4.md` 완료
  - **구현 내용**:
    - `globalThis.fetch`를 호출 시 throw하는 스텁으로 바꾸고 `/present/:id/fullscreen`(단독·청중)과 `/present/:id/control`을 마운트한다
    - 슬라이드 이동·블랙아웃·가사 숨기기까지 조작한 뒤 fetch 호출 0건을 단언한다
    - 배경 `<video src>`는 브라우저가 가져가는 것이므로 jsdom에서는 호출되지 않는다. 이 테스트가 막는 것은 **앱 코드가 직접 부르는 fetch**다
  - **DoD (통과 기준)**: `pnpm exec vitest run src/client/routes/zeroFetch.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 5.2: TECH_SPEC 정정**
  - **대상 파일**: `docs/TECH_SPEC.md`
  - **선행 조건**: Task 5.1
  - **구현 내용**:
    - §2.2 구현 현황표: '발표자 보기·BroadcastChannel', 'PWA·Cache Storage' 행을 구현으로 갱신
    - §5.3: 송출 창 경로를 `/present/:id/fullscreen?audience=1`, 조작 창을 `/present/:id/control`로 정정 (`/present/audience?setId=`는 PRD 화면 목록과 어긋난다)
    - §5.4-2: generateSW 선언형 옵션(`rangeRequests: true` 등)으로 교체하고 플러그인 인스턴스 스니펫이 injectManifest 전용임을 명시
    - §5.4-3: `fetch(url, { mode: 'cors' })` → 동일 출처이므로 `mode` 미지정
    - §5.4-4: IndexedDB 스키마를 실제 v2 기준으로 갱신(`auth_session` 추가, `sync_meta` 확장 필드, `decks`의 `by-presentation` 인덱스 없음)
    - §1.2-3: '로그인은 편집의 전제 조건이 아니다' → 2026-09-22 결정(로그인 게이트)에 맞춰 정정
  - **DoD (통과 기준)**: `grep -n "present/audience" docs/TECH_SPEC.md`가 0건을 돌려준다.

- [x] **Task 5.3: PRD 현황 갱신**
  - **대상 파일**: `prd.md`
  - **선행 조건**: Task 5.2
  - **구현 내용**:
    - §5 화면 목록: '예배 준비', '발표자 보기' 행을 '예정' → '구현'으로
    - §8 현재 구현 현황: M4 항목을 '안 된 것'에서 빼고 코드 완료 사실과 남은 실검증을 적는다
    - §8 로드맵 표의 M4 행 상태 갱신
  - **DoD (통과 기준)**: `grep -n "M4 오프라인" prd.md`의 상태 열이 '대기'가 아니다.

- [x] **Task 5.4: 태스크 가이드 현재 위치 갱신 및 운영자 검증 절차**
  - **대상 파일**: `docs/tasks/AGENTS.md`, `docs/tasks/m4/tasks_5.md`
  - **선행 조건**: Task 5.3
  - **구현 내용**:
    - `docs/tasks/AGENTS.md` §2.1 표에 M4 행을 추가하고 상태를 기록
    - 아래 §4에 운영자가 직접 해야 하는 검증 절차를 남긴다
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test`가 전부 통과한다.

---

## 3. 검증 명령어

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter web build && ls -la dist/client/sw.js
```

---

## 4. 운영자 실검증 절차 (M4 완료 선언 조건)

이 컨테이너에서는 실행할 수 없다. 운영자가 Chrome에서 직접 확인한다.

1. **오프라인 완주** — 배포본(또는 `pnpm --filter web build` 후 프리뷰)을 열고 5곡 세트로 `/present/:id/ready`에 들어가 다운로드를 끝낸다. '오프라인 송출 가능' 배지 확인 → DevTools Network를 **Offline**으로 바꾼다 → 송출을 시작해 5곡을 끝까지 넘긴다. 배경 영상이 끊기지 않고, Network 탭에 실패한 요청이 없어야 한다.
2. **보조 모니터** — 프로젝터(또는 두 번째 모니터)를 연결한 상태에서 `/present/:id/control`의 「송출 창 열기」를 누른다. 창이 보조 모니터에 뜨고, 조작 창에서 넘긴 슬라이드가 즉시 따라오는지 확인한다. 권한을 거부했을 때 안내 문구가 나오는지도 함께 본다.
3. **영구 저장소** — 준비 화면에서 영구 저장소 요청이 승인되는지(Chrome은 사용 이력에 따라 자동 승인/거부한다), 거부 시 경고가 보이는지 확인한다.
4. **브라우저 완전 종료 후 재현** — 브라우저를 껐다 켠 뒤 오프라인 상태로 같은 세트를 송출해 캐시가 살아 있는지 확인한다.

> 로컬 개발 환경에서는 R2 버킷이 비어 있어 `/api/media/*`가 404다(`m3/tasks_1.md`에 기록된 기존 사실). 준비 화면은 이 경우 실패 상태로 표시한다. 검증하려면 `wrangler r2 object put prj-ppt-media/loops/<key>.mp4 --file=<더미> --local --persist-to=.wrangler/state`로 로컬 버킷을 채우면 된다.

### 4.1 2026-09-22에 실제로 확인한 것 (헤드리스 Chrome)

`pnpm --filter web dev`로 API를, 빌드 산출물(`dist/client`)을 정적 서버로 띄워 Service Worker까지 살린 상태에서 확인했다.

| 항목                      | 결과                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Service Worker 등록·활성  | `sw.js` active, 앱 셸 프리캐시 8건                                                                      |
| 예배 준비 화면            | 5곡 전부 '준비 완료', '오프라인 송출 가능' 배지, 총 1.0MB                                               |
| Cache Storage             | `worship-videos-cache` 10건(영상 5 + 포스터 5)                                                          |
| `sync_meta`               | `isReady: true`, `cachedVideos: 10`, `cachedAt` 기록됨                                                  |
| 재방문                    | `/api/media` 요청 0건 (이미 캐시된 것은 다시 받지 않는다)                                               |
| **네트워크 차단 후 송출** | 오프라인 상태에서 `/present/:id/fullscreen` 새로고침 성공, 배경 MP4가 캐시에서 200, **5곡 끝까지 완주** |
| 발표자 보기               | 송출 창 열림·연결 표시, 3회 넘김·곡 점프·블랙아웃·`1.2`+Enter 점프가 모두 청중 창에 즉시 반영           |
| 없는 번호                 | 조작 창에만 '없는 번호입니다: 9.9'가 뜨고 2초 뒤 사라짐                                                 |
| 청중 창 키보드            | 방향키를 눌러도 움직이지 않음                                                                           |
| 송출 종료                 | 청중 창이 닫히고 조작 창은 `/presentations`로                                                           |
| 미디어 헤더               | `cache-control: public, max-age=31536000, immutable`, Range 요청에 206 + `content-range`                |

### 4.2 검증 중 만난 환경 문제 (코드 결함 아님)

- `pnpm --filter web dev`가 `CLOUDFLARE_API_TOKEN` 없이는 뜨지 않는다. AI 바인딩 때문에 원격 바인딩 인증을 요구한다. 검증에서는 `cloudflare({ remoteBindings: false })`로 임시 설정을 만들어 우회했다. 로컬 개발을 자주 한다면 이 옵션을 기본으로 둘지 검토할 만하다(테스트 설정은 이미 `remoteBindings: false`다).

---

## 5. 검증 중 발견한 M4 범위 밖 결함 (2026-09-22 수정 완료)

M4 검증에서 찾아 보고만 했던 2건을 사용자 요청으로 모두 고쳤다. 조사해 보니 두 번째 결함은 원인이 하나 더 있었다.

1. **서버 동기화 500 — 진짜 원인은 `decks.background_id` 외래키였다.** 배경 10건이 클라이언트 상수·`seed.sql`·`seed/backgrounds.ts` 세 군데에 정의만 되어 있고 **D1에 넣는 경로가 없었다.** D1은 외래키를 기본으로 강제하므로 곡에 배경이 붙는 순간 `db.batch()` 전체가 롤백됐다. 마이그레이션 `0002_seed_backgrounds.sql`로 옮겨 `db:migrate:local`·`db:migrate:prod`가 반드시 함께 채우게 했고, 정의는 `@repo/shared` 하나에서 파생시켰다. 모르는 배경 id는 세트를 날리는 대신 `null`로 낮춰 받는다.
2. **같은 곡을 두 번 담으면 동기화가 깨지는 두 번째 폭탄** — `addDeckToPresentation`이 덱을 복제하지 않아 `deck.id`가 겹쳤고, 서버에서 `decks` 기본키와 `presentation_items` 유니크 제약을 동시에 위반했다. TECH_SPEC §4.0-1의 Clone-on-Add를 실제로 구현했다. 이미 중복 id로 저장된 문서는 하이드레이션에서 복구한다.
3. **'기본 5곡 세트 불러오기' 버튼이 세트를 비우던 문제** — 라벨대로 샘플 5곡을 채우게 고쳤다. '세트 비우기'는 UI에서 없앴다(사용자 결정). 빈 편집기 화면은 테스트가 하나도 없어서 이 역전이 드러나지 않았으므로, 그 화면을 덮는 테스트를 추가했다.
4. **`pnpm dev`가 `CLOUDFLARE_API_TOKEN` 없이는 뜨지 않던 문제** — 원격 바인딩을 기본으로 끄고 `CF_REMOTE_BINDINGS=true`일 때만 켠다.

### 5.1 수정 후 실검증 (헤드리스 Chrome, 2026-09-22)

| 항목                                | 결과                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm --filter web dev` (토큰 없음) | 정상 기동                                                                          |
| '기본 5곡 세트 불러오기'            | 곡 목록 (0) → (5)                                                                  |
| 배경 붙은 5곡 세트 동기화           | **동기화됨**, Worker 로그 `FOREIGN KEY` **0건**                                    |
| 같은 곡 3회 추가                    | 덱 id 3개 모두 다름, `scope: presentation`, `presentationId` 일치, 서버에 3곡 저장 |
| 배경 변경 후 동기화                 | 동기화됨, 서버에 바뀐 `backgroundId` 반영                                          |
| **로컬 IndexedDB 삭제 후 재접속**   | **서버에서 세트가 곡까지 그대로 복원 — M3-B 완료 기준을 처음으로 실증**            |
| M4 회귀 (예배 준비·발표자 보기)     | '오프라인 송출 가능' 배지, 송출 창 연결·동기화 모두 정상                           |
