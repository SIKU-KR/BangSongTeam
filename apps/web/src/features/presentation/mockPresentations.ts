import { Presentation, PresentationSchema, Deck } from "@repo/shared";
import {
  mockPresentation,
  mockDecks,
  MOCK_USER_ID,
  MOCK_PRESENTATION_ID,
} from "./mockPresentation";

export const SEED_USER_ID = MOCK_USER_ID;

interface SeedPresentationInput {
  seq: number;
  title: string;
  serviceDate: string;
  deckIndices: number[];
}

const SEED_DEFINITIONS: SeedPresentationInput[] = [
  {
    seq: 2,
    title: "청년부 금요 찬양 집회",
    serviceDate: "2026-09-18",
    deckIndices: [2, 1, 4, 0],
  },
  {
    seq: 3,
    title: "부활절 감사예배 특별 순서",
    serviceDate: "2026-09-13",
    deckIndices: [3, 4, 0],
  },
  {
    seq: 4,
    title: "수요 성령기도회",
    serviceDate: "2026-09-06",
    deckIndices: [0, 1],
  },
  {
    seq: 5,
    title: "주일 1·2부 연합예배",
    serviceDate: "2026-08-30",
    deckIndices: [2, 0, 3],
  },
];

function seedId(prefix: string, seq: number, n: number): string {
  return `${prefix}${seq}${String(n).padStart(19, "0")}`;
}

function buildSeedPresentation(def: SeedPresentationInput): Presentation {
  const presentationId = seedId("1", def.seq, 1);
  const timestamp = `${def.serviceDate}T00:00:00.000Z`;

  const items = def.deckIndices.map((deckIdx, order) => {
    const source = mockDecks[deckIdx];
    const deck: Deck = {
      ...(JSON.parse(JSON.stringify(source)) as Deck),
      id: seedId("2", def.seq, order + 1),
      presentationId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return {
      id: seedId("3", def.seq, order + 1),
      presentationId,
      deckId: deck.id,
      order,
      deck,
    };
  });

  return PresentationSchema.parse({
    id: presentationId,
    userId: SEED_USER_ID,
    title: def.title,
    serviceDate: def.serviceDate,
    items,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

/**
 * 스토어 시드 목록.
 * [0]은 기존 `mockPresentation` (테스트가 단언하는 5곡 23슬라이드 세트), [1..4]는 파생 시드.
 */
export const SEED_PRESENTATIONS: Presentation[] = [
  mockPresentation,
  ...SEED_DEFINITIONS.map(buildSeedPresentation),
];

export const SEED_PRESENTATION_IDS: string[] = SEED_PRESENTATIONS.map(
  (p) => p.id,
);

export { MOCK_PRESENTATION_ID };
