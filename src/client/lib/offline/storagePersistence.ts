import { useSyncExternalStore } from "react";
import { navigatorApi } from "../browser/optionalApis";
import { isProjecting } from "../../features/presentation/fullscreen";

/**
 * 브라우저가 이 사이트의 저장소를 지우지 않게 했는지. `true`면 지우지 않고, `false`면 기기 저장
 * 공간이 모자랄 때 IndexedDB·캐시·서비스 워커를 통째로 지울 수 있으며, `null`이면 지원하지 않거나
 * 아직 확인하지 못했다.
 */
export type StoragePersistence = boolean | null;

let known: StoragePersistence = null;
let pending: Promise<StoragePersistence> | null = null;
const listeners = new Set<() => void>();

async function ask(): Promise<StoragePersistence> {
  const storage = navigatorApi("storage");
  if (!storage || typeof storage.persist !== "function") return null;

  try {
    if (
      typeof storage.persisted === "function" &&
      (await storage.persisted())
    ) {
      return true;
    }
    return await storage.persist();
  } catch {
    return null;
  }
}

/**
 * 브라우저가 저장소를 임의로 비우지 않도록 영구 저장을 요청하고 결과를 돌려준다. 던지지 않는다.
 *
 * 거부되거나 지원하지 않아도 동작에는 영향이 없다. 다만 거부되면 기기 저장 공간이 모자랄 때
 * 브라우저가 오프라인 송출에 쓸 저장본을 예고 없이 지울 수 있어, 결과를 `useStoragePersistence`로
 * 알려 안내하게 한다(`StoragePersistenceNotice`). Firefox는 요청마다 허락을 묻는 창을 띄우므로,
 * 묻는 동안 다시 부르면 새로 묻지 않고 같은 요청을 기다린다.
 *
 * 송출 화면에서는 묻지 않고 마지막으로 확인한 상태를 돌려준다. 그 창이 관객 화면에 뜨면 안 된다.
 * 부팅(`App`)과 배경 받기(`mediaCache`)가 모두 부르므로 이 규칙은 부르는 쪽이 아니라 여기서 지킨다.
 */
export function requestPersistentStorage(): Promise<StoragePersistence> {
  if (isProjecting()) return Promise.resolve(known);
  pending ??= ask().then((result) => {
    pending = null;
    if (result !== known) {
      known = result;
      for (const listener of listeners) listener();
    }
    return result;
  });
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getKnown(): StoragePersistence {
  return known;
}

function getServerSnapshot(): StoragePersistence {
  return null;
}

/** 마지막으로 확인한 영구 저장 상태를 반응형으로 구독한다 (안내 배너용) */
export function useStoragePersistence(): StoragePersistence {
  return useSyncExternalStore(subscribe, getKnown, getServerSnapshot);
}

/** 테스트 격리용: 확인한 상태와 묻고 있는 요청을 버린다 */
export function __resetStoragePersistenceForTests(): void {
  known = null;
  pending = null;
}
