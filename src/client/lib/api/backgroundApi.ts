import {
  BackgroundListEnvelopeSchema,
  BackgroundMediaSchema,
  type BackgroundListResponse,
} from "#shared";
import { api } from "./client";
import { callApi } from "./request";

/**
 * 배경 목록을 받는다. 형식이 맞지 않는 배경은 빼고 나머지를 돌려준다(`loadAllBackgrounds`와
 * 같은 원칙). 목록 자체가 없는 응답만 실패로 던진다.
 */
export async function fetchBackgroundList(): Promise<BackgroundListResponse> {
  const body = await callApi(() => api.api.backgrounds.$get());
  const { backgrounds } = BackgroundListEnvelopeSchema.parse(body);
  return {
    backgrounds: backgrounds.flatMap((row) => {
      const parsed = BackgroundMediaSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    }),
  };
}
