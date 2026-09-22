# Goal: [M4-5] Zero-Fetch 불변식 고정 및 문서 정합화

> **마일스톤**: M4 (오프라인 및 발표자 보기)
> **태스크 번호**: `tasks_5.md`
> **선행 조건**: `docs/tasks/m4/tasks_4.md` 완료 (발표자 보기)
> **목표**: '송출 중 네트워크 요청 0건'을 테스트로 고정하고, M4 구현과 어긋나게 된 PRD·TECH_SPEC·AGENTS 문서를 코드에 맞춘다
> **완료 기준 (DoD)**: 송출 라우트를 마운트해도 `fetch`가 한 번도 호출되지 않고, 문서의 M4 관련 서술이 실제 구현과 일치한다

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **불변식은 문장이 아니라 테스트다**: AGENTS.md §6은 '송출 화면 실행 중 외부 fetch 금지'를 금지 사항으로 적어 두었지만 강제하는 장치가 없었다. 테스트로 고정한다.
2. **문서를 실제와 맞춘다**: `docs/tasks/AGENTS.md` §2.1이 요구하는 대로 '구현 현황'을 사실로 갱신한다. 검증하지 않은 것을 완료로 적지 않는다.
3. **M4 완료 선언은 운영자 검증 뒤에** 한다: 이 컨테이너에서는 보조 모니터도, 실제 네트워크 차단도 확인할 수 없다. 절차만 남기고 마일스톤은 '코드 완료'로 표기한다.

---

## 2. 세부 작업 체크리스트

- [ ] **Task 5.1: 송출 라우트 Zero-Fetch 회귀 테스트**
  - **대상 파일**: `apps/web/src/routes/zeroFetch.test.tsx`
  - **선행 조건**: `tasks_4.md` 완료
  - **구현 내용**:
    - `globalThis.fetch`를 호출 시 throw하는 스텁으로 바꾸고 `/present/:id/fullscreen`(단독·청중)과 `/present/:id/control`을 마운트한다
    - 슬라이드 이동·블랙아웃·가사 숨기기까지 조작한 뒤 fetch 호출 0건을 단언한다
    - 배경 `<video src>`는 브라우저가 가져가는 것이므로 jsdom에서는 호출되지 않는다. 이 테스트가 막는 것은 **앱 코드가 직접 부르는 fetch**다
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/routes/zeroFetch.test.tsx`가 100% 통과(Green)한다.

- [ ] **Task 5.2: TECH_SPEC 정정**
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

- [ ] **Task 5.3: PRD 현황 갱신**
  - **대상 파일**: `prd.md`
  - **선행 조건**: Task 5.2
  - **구현 내용**:
    - §5 화면 목록: '예배 준비', '발표자 보기' 행을 '예정' → '구현'으로
    - §8 현재 구현 현황: M4 항목을 '안 된 것'에서 빼고 코드 완료 사실과 남은 실검증을 적는다
    - §8 로드맵 표의 M4 행 상태 갱신
  - **DoD (통과 기준)**: `grep -n "M4 오프라인" prd.md`의 상태 열이 '대기'가 아니다.

- [ ] **Task 5.4: 태스크 가이드 현재 위치 갱신 및 운영자 검증 절차**
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
pnpm --filter web build && ls -la apps/web/dist/client/sw.js
```

---

## 4. 운영자 실검증 절차 (M4 완료 선언 조건)

이 컨테이너에서는 실행할 수 없다. 운영자가 Chrome에서 직접 확인한다.

1. **오프라인 완주** — 배포본(또는 `pnpm --filter web build` 후 프리뷰)을 열고 5곡 세트로 `/present/:id/ready`에 들어가 다운로드를 끝낸다. '오프라인 송출 가능' 배지 확인 → DevTools Network를 **Offline**으로 바꾼다 → 송출을 시작해 5곡을 끝까지 넘긴다. 배경 영상이 끊기지 않고, Network 탭에 실패한 요청이 없어야 한다.
2. **보조 모니터** — 프로젝터(또는 두 번째 모니터)를 연결한 상태에서 `/present/:id/control`의 「송출 창 열기」를 누른다. 창이 보조 모니터에 뜨고, 조작 창에서 넘긴 슬라이드가 즉시 따라오는지 확인한다. 권한을 거부했을 때 안내 문구가 나오는지도 함께 본다.
3. **영구 저장소** — 준비 화면에서 영구 저장소 요청이 승인되는지(Chrome은 사용 이력에 따라 자동 승인/거부한다), 거부 시 경고가 보이는지 확인한다.
4. **브라우저 완전 종료 후 재현** — 브라우저를 껐다 켠 뒤 오프라인 상태로 같은 세트를 송출해 캐시가 살아 있는지 확인한다.

> 로컬 개발 환경에서는 R2 버킷이 비어 있어 `/api/media/*`가 404다(`m3/tasks_1.md`에 기록된 기존 사실). 준비 화면은 이 경우 실패 상태로 표시한다. 실검증은 실제 영상이 있는 환경에서 해야 한다.
