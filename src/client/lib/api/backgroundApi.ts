import {
  BackgroundDeleteResponseSchema,
  BackgroundListResponseSchema,
  type BackgroundDeleteResponse,
  type BackgroundListResponse,
} from "#shared";
import { api } from "./client";
import { callApi } from "./request";

export async function fetchBackgroundList(): Promise<BackgroundListResponse> {
  const body = await callApi(() => api.api.backgrounds.$get());
  return BackgroundListResponseSchema.parse(body);
}

export async function deleteBackground(
  id: string,
): Promise<BackgroundDeleteResponse> {
  const body = await callApi(() =>
    api.api.backgrounds.uploads[":id"].$delete({ param: { id } }),
  );
  return BackgroundDeleteResponseSchema.parse(body);
}
