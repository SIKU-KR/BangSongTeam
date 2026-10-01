import {
  BackgroundListResponseSchema,
  type BackgroundListResponse,
} from "#shared";
import { api } from "./client";
import { callApi } from "./request";

export async function fetchBackgroundList(): Promise<BackgroundListResponse> {
  const body = await callApi(() => api.api.backgrounds.$get());
  return BackgroundListResponseSchema.parse(body);
}
