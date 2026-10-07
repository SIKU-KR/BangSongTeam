import { navigatorApi } from "../browser/optionalApis";

/**
 * 브라우저가 저장소를 임의로 비우지 않도록 영구 저장을 요청한다.
 * 거부되거나 지원하지 않아도 동작에는 영향이 없어 결과를 알리지 않고 예외도 던지지 않는다.
 */
export async function requestPersistentStorage(): Promise<void> {
  const storage = navigatorApi("storage");
  if (!storage || typeof storage.persist !== "function") return;

  try {
    if (typeof storage.persisted === "function") {
      if (await storage.persisted()) return;
    }
    await storage.persist();
  } catch {
    return;
  }
}
