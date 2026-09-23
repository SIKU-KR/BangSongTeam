import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { signInAsTestUser } from "../../test/sessionFixture";
import {
  DEFAULT_DECK_STYLE,
  INITIAL_BACKGROUNDS,
  type Deck,
} from "@repo/shared";
import {
  closeOfflineDB,
  OFFLINE_DB_NAME,
  savePresentation,
} from "../../lib/storage";
import {
  hydrateFromStorage,
  flushPendingWrites,
  resetPresentationStore,
  createNewPresentation,
  openPresentation,
  addDeckToPresentation,
  duplicateSongInPresentation,
  updatePresentationTitle,
  updateSongStyle,
  updateSongBackground,
  reorderSongs,
  listPresentations,
  getPresentationById,
} from "./presentationStore";

const SONG_TITLES = [
  "시간을 뚫고",
  "은혜로다",
  "주 품에",
  "시선",
  "예수 늘 함께 계시네",
];

function makeDeck(title: string): Deck {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId: "00000000-0000-4000-8000-000000000001",
    catalogId: null,
    scope: "library",
    presentationId: null,
    title,
    artist: "테스트",
    lyricsRaw: `${title} 1절\n\n${title} 2절`,
    slides: [
      { id: `s_${title}_1`, order: 0, lines: [`${title} 1절`] },
      { id: `s_${title}_2`, order: 1, lines: [`${title} 2절`] },
    ],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    visibility: "private",
    forkedFrom: null,
    forkCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

async function resetDatabase(): Promise<void> {
  closeOfflineDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe("영속성 왕복 (편집 → 저장 → 새 탭 복원)", () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDatabase();
    signInAsTestUser();
    resetPresentationStore();
  });

  afterEach(closeOfflineDB);

  it("5곡 세트의 곡 순서·스타일·배경이 재시작 후에도 그대로 복원된다", async () => {
    await hydrateFromStorage();

    // 1. 새 세트를 만들고 5곡을 넣는다
    const created = createNewPresentation("주일 1부 예배");
    openPresentation(created.id);
    for (const title of SONG_TITLES) {
      addDeckToPresentation(makeDeck(title));
    }

    // 2. 제목·스타일·배경을 바꾸고 곡 순서를 뒤집는다
    updatePresentationTitle("주일 1부 예배 (최종)");
    updateSongStyle(0, { overlayOpacity: 75, fontSizeVw: 5.5 });
    const targetBackgroundId = INITIAL_BACKGROUNDS[3].id;
    updateSongBackground(1, targetBackgroundId);
    reorderSongs(0, 4);

    const expected = getPresentationById(created.id);
    expect(expected?.items).toHaveLength(5);

    // 3. 창을 닫기 전 대기 중인 쓰기를 비운다
    await flushPendingWrites();

    // 4. 새 탭 시뮬레이션: 메모리를 버리고 저장소에서 복원
    resetPresentationStore();
    await hydrateFromStorage();

    const restored = getPresentationById(created.id);
    expect(restored).toBeDefined();
    expect(restored?.title).toBe("주일 1부 예배 (최종)");
    expect(restored?.items).toHaveLength(5);
    expect(restored?.items.map((item) => item.deck?.title)).toEqual(
      expected?.items.map((item) => item.deck?.title),
    );
    expect(restored?.items[4].deck?.style.overlayOpacity).toBe(75);
    expect(restored?.items[4].deck?.style.fontSizeVw).toBe(5.5);
    expect(restored?.items[0].deck?.backgroundId).toBe(targetBackgroundId);
  });

  it("복원 후에도 송출에 필요한 슬라이드 내용이 온전하다", async () => {
    await hydrateFromStorage();
    const created = createNewPresentation("송출 확인용");
    openPresentation(created.id);
    addDeckToPresentation(makeDeck("시선"));
    await flushPendingWrites();

    resetPresentationStore();
    await hydrateFromStorage();

    const firstSlide = getPresentationById(created.id)?.items[0].deck
      ?.slides[0];
    expect(firstSlide?.lines).toEqual(["시선 1절"]);
  });

  it("여러 문서를 편집해도 각 문서가 독립적으로 저장된다", async () => {
    await hydrateFromStorage();

    const first = createNewPresentation("1부");
    openPresentation(first.id);
    addDeckToPresentation(makeDeck("은혜로다"));

    const second = createNewPresentation("2부");
    openPresentation(second.id);
    addDeckToPresentation(makeDeck("주 품에"));

    await flushPendingWrites();
    resetPresentationStore();
    await hydrateFromStorage();

    const ids = listPresentations().map((p) => p.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
    expect(getPresentationById(first.id)?.items[0].deck?.title).toBe(
      "은혜로다",
    );
    expect(getPresentationById(second.id)?.items[0].deck?.title).toBe(
      "주 품에",
    );
  });
  it("곡을 복제한 세트도 재시작 후 사라지지 않는다", async () => {
    await hydrateFromStorage();

    const created = createNewPresentation("복제 포함 세트");
    openPresentation(created.id);
    addDeckToPresentation(makeDeck("은혜로다"));
    duplicateSongInPresentation(0);

    expect(getPresentationById(created.id)?.items).toHaveLength(2);
    await flushPendingWrites();

    // 복제 덱 id가 스키마(uuid)를 어기면 문서 전체가 corrupted로 격리되어
    // 목록에서 통째로 사라진다. 저장은 됐는데 다음에 못 여는 최악의 경로다.
    resetPresentationStore();
    await hydrateFromStorage();

    const restored = getPresentationById(created.id);
    expect(restored).toBeDefined();
    expect(restored?.items).toHaveLength(2);
    expect(restored?.items[1].deck?.title).toBe("은혜로다 (사본)");
  });

  it("같은 곡을 두 번 담아도 덱 id가 겹치지 않는다 (Clone-on-Add)", async () => {
    await hydrateFromStorage();

    const created = createNewPresentation("중복 곡 세트");
    openPresentation(created.id);
    const shared = makeDeck("은혜로다");
    addDeckToPresentation(shared);
    addDeckToPresentation(shared);

    const items = getPresentationById(created.id)?.items ?? [];
    expect(items).toHaveLength(2);
    // 겹치면 서버에서 decks 기본키와 presentation_items 유니크 제약을 동시에
    // 위반해 이 세트는 영원히 동기화되지 않는다.
    expect(items[0].deck?.id).not.toBe(items[1].deck?.id);
    expect(items[0].deckId).toBe(items[0].deck?.id);
    expect(items[1].deckId).toBe(items[1].deck?.id);
    // 보관함 원본은 건드리지 않는다.
    expect(shared.scope).toBe("library");
    expect(items[0].deck?.scope).toBe("presentation");
    expect(items[0].deck?.presentationId).toBe(created.id);
  });

  it("예전에 저장된 중복 덱 id 문서를 하이드레이션에서 복구한다", async () => {
    await hydrateFromStorage();

    // Clone-on-Add가 없던 시절 만들어진 저장본을 흉내 낸다.
    const created = createNewPresentation("옛 중복 세트");
    openPresentation(created.id);
    addDeckToPresentation(makeDeck("은혜로다"));
    addDeckToPresentation(makeDeck("주 품에"));
    await flushPendingWrites();

    const broken = getPresentationById(created.id)!;
    const duplicatedId = broken.items[0].deck!.id;
    await savePresentation({
      ...broken,
      items: broken.items.map((item, index) =>
        index === 1
          ? {
              ...item,
              deckId: duplicatedId,
              deck: { ...item.deck!, id: duplicatedId },
            }
          : item,
      ),
    });

    resetPresentationStore();
    await hydrateFromStorage();

    const repaired = getPresentationById(created.id);
    expect(repaired?.items).toHaveLength(2);
    // 곡을 지우지 않고 id만 새로 발급한다.
    expect(repaired?.items[0].deck?.id).not.toBe(repaired?.items[1].deck?.id);
    expect(repaired?.items[1].deckId).toBe(repaired?.items[1].deck?.id);
    expect(repaired?.items[1].deck?.title).toBe("주 품에");

    // 복구본이 저장소에도 반영되어, 다음 부팅에 같은 복구를 되풀이하지 않는다.
    resetPresentationStore();
    await hydrateFromStorage();
    const again = getPresentationById(created.id);
    expect(again?.items[0].deck?.id).not.toBe(again?.items[1].deck?.id);
  });
});
