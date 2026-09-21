import {
  Deck,
  DeckSchema,
  DEFAULT_DECK_STYLE,
  mergeSlidesToLyrics,
  Slide,
} from "@repo/shared";

export interface CustomBackgroundItem {
  id: string;
  title: string;
  mediaUrl: string;
  posterUrl?: string;
  type: "video" | "image";
  createdAt: string;
  tags: string[];
}

const COMMUNITY_USER_ID = "00000000-0000-4000-8000-000000000099";
const CREATED_AT = "2026-09-20T00:00:00.000Z";

interface CommunitySongDef {
  id: string;
  title: string;
  artist: string;
  backgroundId: string;
  slideLines: string[][];
  forkCount: number;
}

const COMMUNITY_SONG_DEFINITIONS: CommunitySongDef[] = [
  {
    id: "c0000000-0000-4000-8000-000000000001",
    title: "시간을 뚫고",
    artist: "WELOVE",
    backgroundId: "b0000000-0000-0000-0000-000000000001",
    forkCount: 42,
    slideLines: [
      ["당신은 시간을 뚫고", "이 땅 가운데 오셨네"],
      ["우리 없는 하늘을 원치 않아", "우리 삶에 오셨네"],
      [
        "자신의 편안 버리고",
        "우리에게 평안 주셨네",
        "가장 낮은 곳으로 오사",
        "우리와 함께 하셨네",
      ],
      [
        "빛으로 오신 주 예수",
        "어둠을 밝히시네",
        "주의 사랑 온 세상 비추사",
        "우릴 구원하셨네",
      ],
    ],
  },
  {
    id: "c0000000-0000-4000-8000-000000000002",
    title: "예수 늘 함께 계시네",
    artist: "마커스워십",
    backgroundId: "b0000000-0000-0000-0000-000000000002",
    forkCount: 38,
    slideLines: [
      ["고단한 인생길 힘겨운 오늘도", "예수 내 마음 아시네"],
      ["지나간 추억과 슬픈 기억들", "예수 내 눈물 아시네"],
      [
        "믿음의 눈 들어 주를 보네",
        "이 모든 순간이 주의 은혜라",
        "어떤 시련도 날 흔들지 못하리",
        "예수 늘 함께 계시네",
      ],
    ],
  },
  {
    id: "c0000000-0000-4000-8000-000000000003",
    title: "주 은혜임을",
    artist: "마커스워십",
    backgroundId: "b0000000-0000-0000-0000-000000000004",
    forkCount: 29,
    slideLines: [
      ["주 나의 모습 보네", "상하고 찢긴 맘 고치시는 주님"],
      ["주 나의 눈물 아네", "홀로 울던 밤 위로하시는 주님"],
      [
        "세상 소망 다 사라져가도",
        "주의 사랑은 끝이 없으니",
        "살아가는 이 모든 순간이",
        "주 은혜임을 나는 믿네",
      ],
    ],
  },
  {
    id: "c0000000-0000-4000-8000-000000000004",
    title: "소원",
    artist: "한웅재",
    backgroundId: "b0000000-0000-0000-0000-000000000006",
    forkCount: 51,
    slideLines: [
      ["삶의 작은 일도 주의 뜻을 구하며", "작은 것에 감사하는 삶을 살리라"],
      ["남을 먼저 생각하고 사랑하며", "주의 겸손을 배우는 삶을 살리라"],
      [
        "나의 작음을 알고 그분의 크심을 알며",
        "소망 그 깊은 곳에 주를 바라는 것",
        "이것이 나의 삶의 행복이라오",
      ],
    ],
  },
  {
    id: "c0000000-0000-4000-8000-000000000005",
    title: "밤이나 낮이나",
    artist: "레베카황",
    backgroundId: "b0000000-0000-0000-0000-000000000003",
    forkCount: 35,
    slideLines: [
      ["나의 영혼이 잠잠히 주를 바라네", "나의 구원이 오직 주께로부터 나오네"],
      [
        "밤이나 낮이나 어제나 오늘도",
        "영원토록 주를 찬양하리라",
        "주의 선하심과 인자하심이",
        "내 삶 속에 영원히 함께하리",
      ],
    ],
  },
];

function buildCommunityDeck(def: CommunitySongDef): Deck {
  const slides: Slide[] = def.slideLines.map((lines, index) => ({
    id: `cslide_${def.id.slice(0, 8)}_${index + 1}`,
    order: index,
    lines,
  }));

  const rawDeck = {
    id: def.id,
    userId: COMMUNITY_USER_ID,
    catalogId: null,
    scope: "library" as const,
    presentationId: null,
    title: def.title,
    artist: def.artist,
    lyricsRaw: mergeSlidesToLyrics(slides),
    slides,
    backgroundId: def.backgroundId,
    style: DEFAULT_DECK_STYLE,
    visibility: "public" as const,
    forkedFrom: null,
    forkCount: def.forkCount,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };

  return DeckSchema.parse(rawDeck);
}

export const COMMUNITY_SONGS: Deck[] =
  COMMUNITY_SONG_DEFINITIONS.map(buildCommunityDeck);

export const INITIAL_MY_BACKGROUNDS: CustomBackgroundItem[] = [
  {
    id: "my-bg-001",
    title: "우리 교회 본당 배경 01",
    mediaUrl: "/api/media/loops/warm_light_flow.mp4",
    posterUrl: "/api/media/posters/warm_light_flow.webp",
    type: "video",
    createdAt: "2026-09-20T10:00:00.000Z",
    tags: ["본당", "따뜻한"],
  },
  {
    id: "my-bg-002",
    title: "청년부 찬양 집회 루프",
    mediaUrl: "/api/media/loops/night_starlight.mp4",
    posterUrl: "/api/media/posters/night_starlight.webp",
    type: "video",
    createdAt: "2026-09-18T18:30:00.000Z",
    tags: ["청년부", "별빛"],
  },
];
