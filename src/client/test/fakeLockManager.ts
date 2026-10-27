interface FakeLock {
  name: string;
  mode: LockMode;
}

const held: FakeLock[] = [];

async function request(
  name: string,
  ...args:
    [LockGrantedCallback<unknown>] | [LockOptions, LockGrantedCallback<unknown>]
): Promise<unknown> {
  const [options, callback] = args.length === 1 ? [{}, args[0]] : args;
  if (options.mode !== "shared") {
    throw new Error("가짜 잠금은 공유 모드만 흉내 낸다");
  }
  const lock: FakeLock = { name, mode: "shared" };
  held.push(lock);
  try {
    return await callback(lock);
  } finally {
    held.splice(held.indexOf(lock), 1);
  }
}

async function query(): Promise<LockManagerSnapshot> {
  await Promise.resolve();
  return {
    held: held.map((lock) => ({ ...lock, clientId: "tab" })),
    pending: [],
  };
}

/**
 * 같은 브라우저의 모든 탭이 함께 보는 Web Locks(`navigator.locks`) 대역. jsdom에는 없다.
 *
 * 모듈을 새로 불러 만든 다른 탭(`vi.resetModules`)도 같은 `navigator`를 보므로 탭끼리 잠금을 함께
 * 본다. 이 앱이 쓰는 공유 모드만 흉내 낸다. 요청을 곧바로 들어주고 콜백이 돌려준 약속이 끝나면
 * 놓으며, `query()`는 잡힌 잠금을 모두 보인다. 브라우저는 요청·풀기·조회를 잠금 작업 큐에서 차례로
 * 처리하므로, 조회는 그보다 먼저 풀린 잠금을 보이지 않게 다음 마이크로태스크에 읽는다. 기다려야 하는
 * 배타 모드는 흉내 내지 않고 던진다. `removeFakeLockManager()`로 되돌린다.
 */
export function installFakeLockManager(): void {
  held.length = 0;
  Object.defineProperty(navigator, "locks", {
    value: { request, query },
    configurable: true,
  });
}

/** Web Locks가 없는 브라우저로 되돌린다 */
export function removeFakeLockManager(): void {
  held.length = 0;
  Reflect.deleteProperty(navigator, "locks");
}
