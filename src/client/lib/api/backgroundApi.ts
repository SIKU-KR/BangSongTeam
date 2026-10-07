import {
  BackgroundListResponseSchema,
  SearchBackgroundsResponseSchema,
  type BackgroundListResponse,
  type SearchBackgroundsResponse,
} from "#shared";
import { api } from "./client";
import { callApi } from "./request";

export async function fetchBackgroundList(): Promise<BackgroundListResponse> {
  const body = await callApi(() => api.api.backgrounds.$get());
  return BackgroundListResponseSchema.parse(body);
}

export async function searchBackgrounds(
  q: string,
): Promise<SearchBackgroundsResponse> {
  const body = await callApi(() =>
    api.api.backgrounds.search.$get({ query: { q } }),
  );
  return SearchBackgroundsResponseSchema.parse(body);
}
