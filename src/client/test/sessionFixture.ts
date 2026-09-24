import {
  __setSessionFetcherForTests,
  __resetSessionForTests,
  __setSessionForTests,
} from "../lib/auth";
import { savePresentation, saveSong } from "../lib/storage";
import { SEED_PRESENTATIONS, SEED_USER_ID } from "../features/presentation";
import type { Deck, Presentation } from "#shared";

const HOUR = 60 * 60 * 1000;

/** 테스트용 로그인 픽스처 */
export function signInAsTestUser(userId: string = SEED_USER_ID): void {
  const user = {
    userId,
    name: "테스트 봉사자",
    image: null,
    expiresAt: Date.now() + HOUR,
  };
  __resetSessionForTests();
  __setSessionForTests(user);
  __setSessionFetcherForTests(async () => user);
}

/** 미로그인 상태로 둔다 */
export function signOutForTests(): void {
  __resetSessionForTests();
  __setSessionFetcherForTests(async () => null);
}

/** 샘플 프레젠테이션을 저장소에 심는다 */
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
