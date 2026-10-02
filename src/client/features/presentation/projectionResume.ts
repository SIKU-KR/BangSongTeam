import { z } from "zod";

const KEY_PREFIX = "chiton:projection:";

const ProjectionResumeSchema = z.object({
  songIndex: z.number().int().nonnegative(),
  slideIndex: z.number().int().nonnegative(),
  itemId: z.string().nullable(),
  hasStarted: z.boolean(),
  isBlackout: z.boolean(),
  isLyricsHidden: z.boolean(),
});

/** 새로고침 뒤 송출을 이어 가는 데 필요한 화면 상태 */
export type ProjectionResume = z.infer<typeof ProjectionResumeSchema>;

function keyOf(presentationId: string): string {
  return `${KEY_PREFIX}${presentationId}`;
}

/**
 * 같은 탭에서 새로고침한 송출이 보던 슬라이드·블랙아웃·가사 숨김 상태로 다시 뜨게 한다.
 * sessionStorage는 탭마다 따로라서 다른 탭·새 창의 송출에는 섞이지 않는다.
 * 저장소를 쓸 수 없거나(사생활 보호 모드, 차단) 값이 깨졌으면 처음부터 시작한다.
 */
export function loadProjectionResume(
  presentationId: string,
): ProjectionResume | null {
  try {
    const raw = window.sessionStorage.getItem(keyOf(presentationId));
    if (raw === null) return null;
    const parsed = ProjectionResumeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveProjectionResume(
  presentationId: string,
  state: ProjectionResume,
): void {
  try {
    window.sessionStorage.setItem(keyOf(presentationId), JSON.stringify(state));
  } catch {
    return;
  }
}

/** 운영자가 송출을 끝내면 지운다. 다음 송출은 첫 슬라이드부터 시작해야 한다 */
export function clearProjectionResume(presentationId: string): void {
  try {
    window.sessionStorage.removeItem(keyOf(presentationId));
  } catch {
    return;
  }
}
