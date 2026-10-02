import {
  Presentation,
  PresentationSchema,
  Deck,
  DeckSchema,
  DEFAULT_DECK_STYLE,
  Slide,
} from "#shared";

export const SEED_USER_ID = "00000000x000000000001";
export const MOCK_PRESENTATION_ID = "100000000000000000001";
const CREATED_AT = "2026-09-20T00:00:00.000Z";

interface SongMockInput {
  deckId: string;
  itemId: string;
  order: number;
  title: string;
  artist: string;
  slideLines: string[][];
}

const SONG_DEFINITIONS: SongMockInput[] = [
  {
    deckId: "200000000000000000001",
    itemId: "300000000000000000001",
    order: 0,
    title: "은혜로다",
    artist: "손경민",
    slideLines: [
      ["시작됐네 우리 주님의 능력이", "나의 삶을 다스리고 새롭게 하네"],
      ["주의 사랑을 주의 선하심을", "주의 은혜를 바라보는 자에게"],
      [
        "은혜로다 주의 은혜",
        "한량없는 주의 은혜",
        "은혜로다 주의 은혜",
        "변함없는 신실하신 주의 은혜",
      ],
      ["나의 모든 것 주께 맡기며", "주의 음성에 순종하며 나아갈 때"],
      [
        "은혜로다 주의 은혜",
        "한량없는 주의 은혜",
        "은혜로다 주의 은혜",
        "변함없는 신실하신 주의 은혜",
      ],
    ],
  },
  {
    deckId: "200000000000000000002",
    itemId: "300000000000000000002",
    order: 1,
    title: "주 품에",
    artist: "Hillsong Worship",
    slideLines: [
      ["주 품에 품으소서", "능력의 팔로 덮으소서"],
      [
        "거친 파도 날 향해 와도",
        "주와 함께 날아오르리",
        "폭풍 가운데 나의 영혼",
        "잠잠하게 주를 보리라",
      ],
      ["주님 안에 나 거하리", "주의 능력 나 잠잠히 믿네"],
      [
        "거친 파도 날 향해 와도",
        "주와 함께 날아오르리",
        "폭풍 가운데 나의 영혼",
        "잠잠하게 주를 보리라",
      ],
    ],
  },
  {
    deckId: "200000000000000000003",
    itemId: "300000000000000000003",
    order: 2,
    title: "시선",
    artist: "김명선",
    slideLines: [
      ["내게로부터 눈을 들어 주를 보기 시작할 때", "주의 일을 보겠네"],
      ["내 작은 마음 돌이키사 하늘의 꿈꾸게 하네", "주님을 볼 때"],
      [
        "모든 시선을 주님께 드리고",
        "살아계신 하나님을 느낄 때",
        "내 삶은 주의 역사가 되고",
        "하나님이 일하기 시작하네",
      ],
      ["성령이 두루 운행하시며", "주의 섭리를 이루시네"],
      [
        "모든 시선을 주님께 드리고",
        "살아계신 하나님을 느낄 때",
        "내 삶은 주의 역사가 되고",
        "하나님이 일하기 시작하네",
      ],
    ],
  },
  {
    deckId: "200000000000000000004",
    itemId: "300000000000000000004",
    order: 3,
    title: "꽃들도",
    artist: "JWorship",
    slideLines: [
      ["이곳에 생명 샘 솟아나", "눈물 골짝 지나갈 때에"],
      ["머잖아 열매 맺히고", "웃음소리 넘쳐나리라"],
      [
        "꽃들도 구름도 바람도 넓은 바다도",
        "찬양하라 찬양하라 예수를",
        "하늘을 울리며 노래해 나의 영혼아",
        "은혜의 주 은혜의 주 은혜의 주",
      ],
      ["예수님 오실 그날에", "우리 다 함께 기뻐하리"],
      [
        "꽃들도 구름도 바람도 넓은 바다도",
        "찬양하라 찬양하라 예수를",
        "하늘을 울리며 노래해 나의 영혼아",
        "은혜의 주 은혜의 주 은혜의 주",
      ],
    ],
  },
  {
    deckId: "200000000000000000005",
    itemId: "300000000000000000005",
    order: 4,
    title: "주의 이름 높이며",
    artist: "Rick Founds",
    slideLines: [
      [
        "주의 이름 높이며",
        "주를 찬양합니다",
        "내 삶 속에 오셔서",
        "우릴 구원하셨네",
      ],
      ["하늘 영광 버리고 이 땅 위에", "십자가를 지시고 죄 사했네"],
      ["무덤에서 일어나 하늘로 올리셨네", "주의 이름 높이리"],
      [
        "하늘 영광 버리고 이 땅 위에",
        "십자가를 지시고 죄 사했네",
        "무덤에서 일어나 하늘로 올리셨네",
        "주의 이름 높이리",
      ],
    ],
  },
];

function mergeSlidesToLyrics(slides: Slide[]): string {
  return slides.map((slide) => slide.lines.join("\n")).join("\n\n");
}

function buildMockDeck(def: SongMockInput): Deck {
  const slides: Slide[] = def.slideLines.map((lines, index) => ({
    id: `slide_${def.deckId.slice(0, 8)}_${index + 1}`,
    order: index,
    lines,
  }));

  const rawDeck = {
    id: def.deckId,
    userId: SEED_USER_ID,
    scope: "presentation" as const,
    presentationId: MOCK_PRESENTATION_ID,
    title: def.title,
    artist: def.artist,
    lyricsRaw: mergeSlidesToLyrics(slides),
    slides,
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    visibility: "private" as const,
    forkedFrom: null,
    forkCount: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };

  return DeckSchema.parse(rawDeck);
}

export const mockDecks: Deck[] = SONG_DEFINITIONS.map(buildMockDeck);

export const mockPresentation: Presentation = PresentationSchema.parse({
  id: MOCK_PRESENTATION_ID,
  userId: SEED_USER_ID,
  title: "2026 주일 3부 예배",
  serviceDate: "2026-09-20",
  items: SONG_DEFINITIONS.map((def, idx) => ({
    id: def.itemId,
    presentationId: MOCK_PRESENTATION_ID,
    deckId: def.deckId,
    order: idx,
    deck: mockDecks[idx],
  })),
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
});

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
 * [0]은 `mockPresentation` (테스트가 단언하는 5곡 23슬라이드 프레젠테이션), [1..4]는 파생 시드.
 */
export const SEED_PRESENTATIONS: Presentation[] = [
  mockPresentation,
  ...SEED_DEFINITIONS.map(buildSeedPresentation),
];

export const SEED_PRESENTATION_IDS: string[] = SEED_PRESENTATIONS.map(
  (p) => p.id,
);
