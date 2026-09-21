import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_DECK_STYLE,
  INITIAL_BACKGROUNDS,
  type Deck,
} from "@repo/shared";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../../lib/storage";
import {
  hydrateFromStorage,
  flushPendingWrites,
  resetPresentationStore,
  createNewPresentation,
  openPresentation,
  addDeckToPresentation,
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
});
