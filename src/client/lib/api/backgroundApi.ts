import {
  BackgroundDeleteResponseSchema,
  BackgroundListResponseSchema,
  BackgroundUploadResponseSchema,
  type BackgroundDeleteResponse,
  type BackgroundListResponse,
  type BackgroundUploadResponse,
} from "#shared";
import { api } from "./client";
import { callApi } from "./request";

export async function fetchBackgroundList(): Promise<BackgroundListResponse> {
  const body = await callApi(() => api.api.backgrounds.$get());
  return BackgroundListResponseSchema.parse(body);
}

export interface BackgroundUploadInput {
  file: File;
  poster?: File;
  title: string;
  license: string;
  tags: string[];
  durationSec: number;
}

/** 관리자 전용. 라이선스 확인 동의는 호출하는 화면이 받은 뒤에만 부른다 */
export async function uploadBackground(
  input: BackgroundUploadInput,
): Promise<BackgroundUploadResponse> {
  const form = {
    file: input.file,
    title: input.title,
    license: input.license,
    tags: JSON.stringify(input.tags),
    durationSec: String(Math.max(0, Math.round(input.durationSec))),
    acceptedRightsNotice: "true" as const,
    ...(input.poster ? { poster: input.poster } : {}),
  };
  const body = await callApi(() => api.api.backgrounds.uploads.$post({ form }));
  return BackgroundUploadResponseSchema.parse(body);
}

export async function deleteBackground(
  id: string,
): Promise<BackgroundDeleteResponse> {
  const body = await callApi(() =>
    api.api.backgrounds.uploads[":id"].$delete({ param: { id } }),
  );
  return BackgroundDeleteResponseSchema.parse(body);
}
