import {
  __setSessionFetcherForTests,
  __resetSessionForTests,
  __setSessionForTests,
} from "../lib/auth";
import { savePresentation, saveSong } from "../lib/storage";
import { SEED_PRESENTATIONS, SEED_USER_ID } from "../features/presentation";
import type { Deck, Presentation } from "@repo/shared";

const HOUR = 60 * 60 * 1000;

/**
 * 테스트용 로그인 픽스처.
 *
 * 로그인이 편집의 전제 조건이 되면서(2026-09-22) 화면 테스트는 세션부터
 * 만들어야 한다. 또 부팅 시 샘플을 자동 생성하지 않으므로, 데이터가 필요한
 * 테스트는 저장소에 직접 심어야 한다.
 */
export function signInAsTestUser(userId: string = SEED_USER_ID): void {
  const user = {
    userId,
    name: "테스트 봉사자",
    image: null,
    expiresAt: Date.now() + HOUR,
  };
  __resetSessionForTests();
  // 상태를 즉시 세팅한다. 스토어 단위 테스트는 hydrateSession()을 거치지
  // 않으므로 조회기만 바꿔서는 getCurrentUserId()가 null이다.
  __setSessionForTests(user);
  __setSessionFetcherForTests(async () => user);
}

/** 미로그인 상태로 둔다 */
export function signOutForTests(): void {
  __resetSessionForTests();
  __setSessionFetcherForTests(async () => null);
}

/** 샘플 프레젠테이션을 저장소에 심는다 (예전 부팅 시드의 대체) */
export async function seedPresentationsIntoStorage(
  documents: Presentation[] = SEED_PRESENTATIONS,
): Promise<void> {
  for (const document of documents) {
    await savePresentation(document);
  }
}

/** 보관함 곡을 저장소에 심는다 */
export async function seedSongsIntoStorage(decks: Deck[]): Promise<void> {
  for (const deck of decks) {
    await saveSong(deck);
  }
}
