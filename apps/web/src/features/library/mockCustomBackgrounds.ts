/**
 * 사용자 커스텀 배경(PRD 4.3) 화면의 샘플 데이터.
 *
 * 업로드는 아직 없다. 배경 라이브러리 화면의 '내가 등록한 배경' 칸만 이 값으로 채운다.
 * (공유 찬양 샘플은 M5에서 실제 공유 라이브러리로 바뀌어 지웠다.)
 */
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
