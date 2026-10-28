import {
  BackgroundListEnvelopeSchema,
  BackgroundMediaSchema,
  type BackgroundMedia,
} from "#shared";
import { api } from "./client";
import { callApi } from "./request";

const BackgroundRowIdSchema = BackgroundMediaSchema.pick({ id: true });

export interface FetchedBackgroundList {
  backgrounds: BackgroundMedia[];
  /** 서버에는 있지만 형식이 어긋나 읽지 못한 배경의 id. id까지 읽지 못한 행은 빠진다 */
  unreadableIds: string[];
}

/**
 * 배경 목록을 받는다. 형식이 맞지 않는 배경은 빼고 나머지를 돌려준다(`loadAllBackgrounds`와
 * 같은 원칙). 운영자가 손으로 고친 배경 하나 때문에 모든 기기가 새 목록을 받지 못하면 안 된다.
 *
 * 목록 자체가 없거나, 배경이 있는데 하나도 읽지 못하면 받지 못한 것으로 던진다. 배포가 엇갈려
 * 필드를 바꾸거나 운영자가 모든 배경을 한꺼번에 잘못 고친 응답을 빈 목록으로 받으면, 모든 기기가
 * 카탈로그와 송출용 사본을 통째로 비운다. 던지면 호출자가 가진 사본을 그대로 쓴다.
 */
export async function fetchBackgroundList(): Promise<FetchedBackgroundList> {
  const body = await callApi(() => api.api.backgrounds.$get());
  const { backgrounds: rows } = BackgroundListEnvelopeSchema.parse(body);
  const backgrounds: BackgroundMedia[] = [];
  const unreadableIds: string[] = [];
  let firstError: Error | null = null;
  for (const row of rows) {
    const parsed = BackgroundMediaSchema.safeParse(row);
    if (parsed.success) {
      backgrounds.push(parsed.data);
      continue;
    }
    firstError ??= parsed.error;
    const id = BackgroundRowIdSchema.safeParse(row);
    if (id.success) unreadableIds.push(id.data.id);
  }
  if (firstError && backgrounds.length === 0) throw firstError;
  return { backgrounds, unreadableIds };
}
