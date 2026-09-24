import {
  applyServerBackgroundCatalog,
  markBackgroundCatalogStatus,
} from "../../features/backgrounds/backgroundCatalog";
import { fetchBackgroundList } from "../api/backgroundApi";
import { OfflineError } from "./presentationSync";

let inFlight: Promise<void> | null = null;

/**
 * 서버 배경 목록을 받아 로컬 카탈로그를 맞춘다.
 *
 * 부팅 동기화·배경 갤러리·배경 선택 창이 부른다. 송출 화면은 부르지 않는다.
 * 실패해도 로컬 사본으로 계속 쓰므로 예외를 던지지 않는다. 동시에 여러 곳에서
 * 불러도 요청은 한 번만 나간다.
 */
export function refreshBackgroundCatalog(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { backgrounds, canManage } = await fetchBackgroundList();
      await applyServerBackgroundCatalog(backgrounds, canManage);
    } catch (err) {
      markBackgroundCatalogStatus(
        err instanceof OfflineError ? "offline" : "error",
      );
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
