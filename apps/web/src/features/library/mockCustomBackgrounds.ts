/** 사용자 등록 배경 샘플 데이터. */
export interface CustomBackgroundItem {
  id: string;
  title: string;
  mediaUrl: string;
  posterUrl?: string;
  type: "video" | "image";
  createdAt: string;
  tags: string[];
}

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
