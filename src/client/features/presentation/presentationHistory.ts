import type { Presentation } from "#shared";

interface DocumentHistory {
  undo: Presentation[];
  redo: Presentation[];
}

const histories = new Map<string, DocumentHistory>();
const MAX_HISTORY = 100;
const COALESCE_WINDOW_MS = 1000;

let lastPush: { docId: string; key: string; at: number } | null = null;

function historyFor(id: string): DocumentHistory {
  let history = histories.get(id);
  if (!history) {
    history = { undo: [], redo: [] };
    histories.set(id, history);
  }
  return history;
}

/**
 * 편집 직전 문서를 되돌리기 기록에 남긴다. 같은 `coalesceKey`로 1초 안에 다시
 * 들어오면 기록을 늘리지 않고 한 단계로 묶는다. 새 기록이 생기면 다시 하기는 비운다.
 *
 * 기록은 문서 객체의 참조를 그대로 보관한다. 스토어의 모든 편집이 바뀐 경로만 새
 * 객체로 만드는 불변 갱신이라, 기록끼리 바뀌지 않은 곡·슬라이드를 공유해 직렬화
 * 비용이 없고, 되돌린 뒤에도 바뀌지 않은 곡의 참조가 유지되어 썸네일·넘침 분석
 * 캐시가 그대로 맞는다. 스토어 밖에서 문서 객체를 직접 고치면 기록이 함께 바뀐다.
 */
export function recordHistory(
  docId: string,
  snapshot: Presentation,
  coalesceKey?: string,
): void {
  const now = Date.now();
  if (
    coalesceKey &&
    lastPush &&
    lastPush.docId === docId &&
    lastPush.key === coalesceKey &&
    now - lastPush.at < COALESCE_WINDOW_MS
  ) {
    lastPush.at = now;
    return;
  }
  lastPush = coalesceKey ? { docId, key: coalesceKey, at: now } : null;

  const history = historyFor(docId);
  history.undo.push(snapshot);
  if (history.undo.length > MAX_HISTORY) {
    history.undo.shift();
  }
  history.redo.length = 0;
}

/** 되돌릴 문서를 꺼내고 지금 문서를 다시 하기 기록에 넣는다. 기록이 없으면 `undefined`다. */
export function takeUndo(
  docId: string,
  current: Presentation,
): Presentation | undefined {
  lastPush = null;
  const history = historyFor(docId);
  const previous = history.undo.pop();
  if (!previous) return undefined;
  history.redo.push(current);
  return previous;
}

/** 다시 할 문서를 꺼내고 지금 문서를 되돌리기 기록에 넣는다. 기록이 없으면 `undefined`다. */
export function takeRedo(
  docId: string,
  current: Presentation,
): Presentation | undefined {
  lastPush = null;
  const history = historyFor(docId);
  const next = history.redo.pop();
  if (!next) return undefined;
  history.undo.push(current);
  return next;
}

export function canUndoDocument(docId: string): boolean {
  return (histories.get(docId)?.undo.length ?? 0) > 0;
}

export function canRedoDocument(docId: string): boolean {
  return (histories.get(docId)?.redo.length ?? 0) > 0;
}

/**
 * 되돌리기 묶음을 끊는다. 슬라이더를 끌거나 가사를 입력하는 동안의 연속 변경은
 * 같은 키로 1초 안에 들어오면 한 단계로 묶이는데, 편집 시작·종료처럼 사용자가
 * 한 동작을 마쳤다고 볼 수 있는 시점에 호출해 다음 변경을 새 단계로 만든다.
 */
export function breakHistoryCoalescing(): void {
  lastPush = null;
}

/**
 * `docId`를 주면 그 문서의 기록만 지운다(묶음 상태는 그대로). 생략하면 모든 문서의
 * 기록과 묶음 상태를 지운다. 저장소에서 다시 불러온 문서에 이전 기록이 남으면 안 된다.
 */
export function clearHistory(docId?: string): void {
  if (docId !== undefined) {
    histories.delete(docId);
    return;
  }
  histories.clear();
  lastPush = null;
}
