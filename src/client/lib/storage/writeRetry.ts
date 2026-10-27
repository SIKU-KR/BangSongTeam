import { BackoffTracker } from "../sync/backoff";
import {
  clearPersistenceError,
  reportPersistenceError,
  type PersistenceStore,
} from "./persistenceStatus";

/** 저장소에 한 쓰기의 종류 */
export type WriteOp = "save" | "delete";

/** 한 저장소의 실패한 쓰기를 항목별로 기억하고 다시 시도한다 (`createWriteRetry`) */
export interface WriteRetry<Op extends string = WriteOp> {
  /**
   * 그 항목을 저장소에 썼거나 더 쓸 것이 없다. 실패한 적 없는 항목은 무시한다. `op`를 주면 그
   * 쓰기로 실패한 항목일 때만 지운다.
   */
  succeeded(id: string, op?: Op): void;
  /** 그 항목의 쓰기(`op`)가 실패했다. 경고를 올리고 다시 시도를 예약한다 */
  failed(id: string, op: Op, err: unknown): void;
  /** 그 항목의 쓰기가 실패한 채 남아 있는지 */
  has(id: string): boolean;
  /**
   * 예약한 다시 시도를 백오프를 기다리지 않고 지금 한다. 창을 닫거나 계정이 끝날 때처럼 다시 시도할
   * 때까지 페이지가 남지 않을 수 있는 마지막 저장에 쓴다. 다시 시도가 이미 도는 중이면(타이머가 울려
   * 쓰는 중) 같은 쓰기를 겹쳐 하지 않는다. 또 실패하면 다음 대기로 다시 예약한다.
   */
  retryNow(): void;
  /** 실패한 항목·예약한 다시 시도·경고를 모두 버린다 (다시 불러오기·테스트 격리) */
  reset(): void;
}

/**
 * 저장소(`source`)의 실패한 쓰기를 항목마다 실패한 쓰기와 함께 기억하고, 백오프 뒤에
 * `retry`에 넘겨 다시 쓰게 한다. 그 저장소의 저장 실패 경고는 실패한 항목이 하나도 남지 않을 때
 * 지운다. 다른 항목이 저장됐다고 지우면 저장하지 못한 작업이 메모리에만 남은 채 저장된 줄 알게
 * 된다.
 *
 * 다시 쓸 때는 항목의 지금 사본을 쓴다. 실패한 쓰기를 기억하는 것은 다시 쓸 때 항목이 메모리에
 * 없을 때를 가르기 위해서다. 지우다 실패한 항목이면 다시 지우고, 저장하다 실패한 항목이면 지우지
 * 않고 실패만 푼다. 메모리는 사용자가 지우지 않아도 빌 수 있어(불러오기 실패, 부팅 중 로그아웃,
 * 계정 바꾸기), 메모리만 보고 지우면 아직 올리지 못한 저장본을 잃는다.
 *
 * 실패한 항목은 이 추적기만 들고 다시 시도는 이 타이머와 마지막 저장(`retryNow`)만 한다. 편집할
 * 때마다 실패한 항목을 함께 다시 쓰면, 저장 공간이 찬 동안 편집마다 실패할 쓰기를 되풀이한다. 대기는
 * `backoff`로 늘리고(최대 1분), 모두 저장되면 처음 대기로 돌아간다.
 */
export function createWriteRetry<Op extends string = WriteOp>(
  source: PersistenceStore,
  retry: (failed: ReadonlyMap<string, Op>) => void,
  backoff: BackoffTracker = new BackoffTracker(),
): WriteRetry<Op> {
  const failedOps = new Map<string, Op>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const retryFailed = (): void => {
    timer = null;
    retry(new Map(failedOps));
  };

  return {
    succeeded(id, op) {
      const failedOp = failedOps.get(id);
      if (failedOp === undefined || (op !== undefined && op !== failedOp)) {
        return;
      }
      failedOps.delete(id);
      if (failedOps.size > 0) return;
      cancelTimer();
      backoff.reset();
      clearPersistenceError(source);
    },
    failed(id, op, err) {
      failedOps.set(id, op);
      reportPersistenceError(err, source);
      if (timer) return;
      timer = setTimeout(retryFailed, backoff.getDelay(err));
    },
    has(id) {
      return failedOps.has(id);
    },
    retryNow() {
      if (!timer) return;
      clearTimeout(timer);
      retryFailed();
    },
    reset() {
      failedOps.clear();
      cancelTimer();
      backoff.reset();
      clearPersistenceError(source);
    },
  };
}
