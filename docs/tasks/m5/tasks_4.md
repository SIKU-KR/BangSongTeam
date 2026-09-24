# Goal: [M5-4] LLM 가사 정규화 파이프라인 (packages/shared, packages/db, worker)

> **2026-09-23 범위 변경**: 이 태스크의 산출물은 **전부 제거됐다**. LLM 가사 정규화와 가사 라이브러리는 MVP 범위에서 빠졌다 (`migrations/0005_remove_catalog.sql`). 이 문서는 이력으로만 남긴다.

> **마일스톤**: M5 (공유·가사 라이브러리)
> **태스크 번호**: `tasks_4.md`
> **선행 조건**: `docs/tasks/m5/tasks_2.md` 완료 (서버측 기여, `changed` 신호)
> **목표**: 한 곡에 서로 다른 사용자의 루트 버전이 2개 이상 쌓이면 Workers AI(Qwen3.8 27B)로 대표 가사를 만들고, 입력에 없는 줄이 하나라도 있으면 버리고 최다 등록 버전을 쓴다 (PRD 4.8, TECH_SPEC §6)
> **완료 기준 (DoD)**: 두 계정이 같은 곡을 조금씩 다르게 등록하면 응답 뒤 백그라운드에서 카탈로그가 `status='normalized'`가 되고, 그 대표 가사가 `verifyNormalization(대표 가사, 입력 버전들)`을 통과한다. 모델이 환각하거나 실패하면 `canonical_source='popular_root'`로 떨어진다

> **구현 현황 (2026-09-23)**
>
> - Task 4.1~4.6 완료. 전체 **835개 / 101파일 Green**.
> - **원안에 없던 검증 — `isPlausiblyComplete`.** `verifyNormalization`은 '입력에 없는 줄'만 잡아서, 모델이 곡의 절반만 내놓아도 통과한다. 가장 짧은 입력 버전의 80%보다 줄이 적으면 LLM 결과를 버린다. PRD 4.8의 검증을 좁힌 것이 아니라 더한 것이다.
> - 최다 등록 버전으로 떨어져도 `status`는 `'normalized'`다. PRD 4.8 표시 규칙('정규화됨 · N명 등록')은 루트 버전이 2개 이상인 곡에 대한 것이고, 누가 만들었는지는 `canonical_source`(`llm`·`popular_root`)로 따로 남긴다.
> - 쓰기는 `RETURNING`으로 실제로 바뀐 행이 있는지 확인한다. D1과 better-sqlite3의 `changes` 보고 방식이 달라서다.
> - `AI_GATEWAY_ID`(선택)를 두면 AI Gateway를 거친다. Gateway의 월 비용 상한에 닿아 호출이 실패하면 자동으로 최다 등록 버전이 대표 가사가 된다 (PRD 9장 '상한 도달 시 최다 등록 버전 방식으로 자동 전환').
> - **실모델 확인은 남아 있다.** 로컬·테스트는 원격 바인딩을 끄므로 모델은 가짜다. 실제 Qwen이 `enable_thinking: false`를 지키는지, 출력 형식이 맞는지는 런북(`docs/ops/moderation-runbook.md`)의 원격 스모크 절차로 운영자가 확인한다.

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **모델 고정**: `@cf/qwen/qwen3.8-27b`, `temperature: 0`, thinking off(`chat_template_kwargs: { enable_thinking: false }`). 모델을 바꾸면 정규화 품질을 다시 검증해야 한다 (PRD 7.1).
2. **검증 실패·모든 오류 = 폴백**: 예외, 빈 출력, `finish_reason: 'length'`(잘림), `verifyNormalization` 실패, 원문보다 지나치게 짧은 출력 — 모두 LLM 출력을 버리고 최다 등록 루트 버전을 쓴다.
3. **잠긴 곡은 건너뛴다**: 운영자가 잠근 대표 가사(`status='locked'`)는 자동 정규화가 절대 건드리지 않는다. 쓰기 조건에도 `status != 'locked'`를 둔다.
4. **응답을 막지 않는다**: `c.executionCtx.waitUntil()`로 응답 뒤에 돈다. 곡 저장 응답은 모델을 기다리지 않는다 (TECH_SPEC §6.1).
5. **호출은 필요할 때만**: 버전이 새로 생기거나 바뀌었고(`changed`), 버전이 2개 이상이고, 잠기지 않았을 때만 부른다. 같은 가사를 다시 저장해도 모델을 부르지 않는다 (PRD 9장 LLM 호출 비용).
6. **순수 로직은 `packages/shared`에**: 프롬프트·출력 정리·최다 버전 선택은 브라우저·Worker 어디서든 도는 순수 함수다. 테스트에서 모델은 주입한 가짜로 바꾼다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 4.1: 정규화 순수 유틸 (TDD)**
  - **대상 파일**: `src/shared/utils/normalization.ts`, `normalization.test.ts`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `normalizeLyricsText(text)` — 줄 앞뒤 공백 제거, 연속 빈 줄 하나로, 앞뒤 빈 줄 제거 (절 사이 빈 줄 통일)
    - `pickPopularRoot(versions)` — 공백을 무시하고 같은 가사끼리 묶어 가장 많은 사람이 등록한 버전. 동률이면 먼저 등록된 쪽
    - `buildNormalizationMessages(versions)` — TECH_SPEC §6.2 시스템 프롬프트 + '가사만 출력'
    - `extractModelText(raw)` — `<think>` 블록과 코드펜스를 걷어낸다 (thinking off가 무시될 때 대비)
    - `isPlausiblyComplete(candidate, versions)` — 가장 짧은 입력 버전의 80%보다 줄이 적으면 거부. `verifyNormalization`은 '없는 줄'만 잡고 '빠진 줄'은 못 잡는다
    - `suggestMaxTokens(versions)` — 입력 길이에 맞춘 출력 상한
  - **DoD (통과 기준)**: `pnpm vitest run src/shared/utils/normalization.test.ts`가 100% 통과(Green)한다.

- [x] **Task 4.2: 정규화 쿼리 헬퍼 (TDD)**
  - **대상 파일**: `src/db/queries/normalization.ts`, `normalization.test.ts`
  - **선행 조건**: Task 4.1
  - **구현 내용**:
    - `getNormalizationInput(db, catalogId)` — 카탈로그와 루트 버전들, 비교용 revision(`updated_at`·`version_count`)
    - `applyCanonical(db, catalogId, { canonical, source, expected })` — `status != 'locked'`이고 revision이 그대로일 때만 쓴다(compare-and-set). D1에는 대화형 트랜잭션이 없어, 모델을 기다리는 사이 새 버전이 들어오면 옛 입력으로 만든 결과가 새 상태를 덮을 수 있다
  - **DoD (통과 기준)**: `pnpm vitest run src/db/queries/normalization.test.ts`가 100% 통과(Green)한다.

- [x] **Task 4.3: 정규화 실행기 (TDD)**
  - **대상 파일**: `src/worker/lib/normalization.ts`, `normalization.test.ts`
  - **선행 조건**: Task 4.2
  - **구현 내용**:
    - `NORMALIZATION_MODEL`, `ModelRunner` 타입, `createWorkersAiRunner(ai, gatewayId?)` — `choices[0].message.content`와 `finish_reason`을 읽는다. `AI_GATEWAY_ID`가 있으면 AI Gateway로 보낸다 (호출 로그·요청 제한·비용 상한, PRD 7.1)
    - `normalizeCatalog(db, catalogId, runner)` → `llm | popular_root | skipped_locked | skipped_single | stale | missing`
    - 케이스: 검증 통과, 환각, 모델 예외, `<think>` 누출, `length` 잘림, 지나치게 짧은 출력, 잠긴 곡, 버전 1개
  - **DoD (통과 기준)**: `pnpm vitest run src/worker/lib/normalization.test.ts`가 100% 통과(Green)한다.

- [x] **Task 4.4: 백그라운드 실행 헬퍼**
  - **대상 파일**: `src/worker/lib/background.ts`
  - **선행 조건**: 없음
  - **구현 내용**: `runInBackground(c, label, task)` — `waitUntil`로 넘기고 오류는 로그로만 남긴다. 실행 컨텍스트가 없는 호출(일부 테스트)에서도 던지지 않는다
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 4.5: 기여 뒤 정규화 트리거**
  - **대상 파일**: `src/worker/routes/decks.ts`, `worker/deps.ts`, `worker/types.ts`, `worker/routes/lyrics.test.ts`
  - **선행 조건**: Task 4.3, 4.4
  - **구현 내용**:
    - `AppDeps.modelRunner?: (env) => ModelRunner` — 기본은 `env.AI`
    - `PUT /api/decks/:id`에서 기여가 `changed && versionCount >= 2 && !locked`면 백그라운드 정규화
    - 테스트: `cloudflare:test`의 `createExecutionContext`/`waitOnExecutionContext`로 백그라운드 작업 완료를 기다린 뒤 카탈로그 상태를 본다. 같은 가사 재저장은 모델을 부르지 않는다
  - **DoD (통과 기준)**: `pnpm vitest run src/worker/routes/lyrics.test.ts`가 100% 통과(Green)한다.

- [x] **Task 4.6: 전체 검증**
  - **대상 파일**: 없음
  - **선행 조건**: Task 4.1~4.5
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test`가 모두 통과한다.

---

## 3. 검증 명령어

```bash
pnpm vitest run src/shared/utils/normalization.test.ts src/db/queries/normalization.test.ts src/worker/
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

`tasks_5.md` — 프론트엔드 공유 UI (샘플 데이터 제거, 서버 검색·가져오기, 공개 설정, 곡 식별, 신고).
