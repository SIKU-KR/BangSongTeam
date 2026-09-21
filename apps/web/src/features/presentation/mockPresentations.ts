import { Presentation, PresentationSchema, Deck } from "@repo/shared";
import {
  mockPresentation,
  mockDecks,
  MOCK_USER_ID,
  MOCK_PRESENTATION_ID,
} from "./mockPresentation";

/**
 * 멀티 문서 시드 데이터 (목 데이터 전용)
 * - `mockPresentation`(5곡 23슬라이드)에 더해, 홈 대시보드가 여러 문서를 보여줄 수 있도록
 *   기존 `mockDecks`를 조합해 4개의 프레젠테이션을 파생시킨다.
 * - 각 시드는 자신만의 덱/아이템 UUID를 갖는다 (문서 간 id 중복 없음).
 * - D1 연동 시에는 이 파일 전체가 실제 쿼리로 대체된다.
 */

export const SEED_USER_ID = MOCK_USER_ID;

interface SeedPresentationInput {
  /** 시드 번호 (2..5) — 파생 UUID의 두 번째 nibble로 사용 */
  seq: number;
  title: string;
  /** 'YYYY-MM-DD' */
  serviceDate: string;
  /** 재사용할 `mockDecks` 인덱스 (등장 순서대로 배치) */
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

/** `{prefix}{seq}000000-0000-4000-8000-{n}` 형태의 결정적 UUID 생성 */
function seedUuid(prefix: string, seq: number, n: number): string {
  return `${prefix}${seq}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function buildSeedPresentation(def: SeedPresentationInput): Presentation {
  const presentationId = seedUuid("1", def.seq, 1);
  // 홈 "최근" 정렬이 의미를 갖도록 예배일과 동일한 날짜를 수정 시각으로 사용
  const timestamp = `${def.serviceDate}T00:00:00.000Z`;

  const items = def.deckIndices.map((deckIdx, order) => {
    const source = mockDecks[deckIdx];
    const deck: Deck = {
      ...(JSON.parse(JSON.stringify(source)) as Deck),
      id: seedUuid("2", def.seq, order + 1),
      presentationId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return {
      id: seedUuid("3", def.seq, order + 1),
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
