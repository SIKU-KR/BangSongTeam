import {
  JoinShareResponseSchema,
  ShareSettingsSchema,
  type JoinShareResponse,
  type LinkAccess,
  type ShareSettings,
} from "#shared";
import { api } from "./client";
import { callApi } from "./request";

export async function fetchShareSettings(id: string): Promise<ShareSettings> {
  const body = await callApi(() =>
    api.api.presentations[":id"].share.$get({ param: { id } }),
  );
  return ShareSettingsSchema.parse(body);
}

export async function updateShareSettings(
  id: string,
  access: LinkAccess,
): Promise<ShareSettings> {
  const body = await callApi(() =>
    api.api.presentations[":id"].share.$put({
      param: { id },
      json: { access },
    }),
  );
  return ShareSettingsSchema.parse(body);
}

export async function resetShareLink(id: string): Promise<ShareSettings> {
  const body = await callApi(() =>
    api.api.presentations[":id"].share.reset.$post({ param: { id } }),
  );
  return ShareSettingsSchema.parse(body);
}

export async function joinSharedPresentation(
  token: string,
): Promise<JoinShareResponse> {
  const body = await callApi(() =>
    api.api.share[":token"].join.$post({ param: { token } }),
  );
  return JoinShareResponseSchema.parse(body);
}

/** 공유 링크 주소. 토큰만 서버가 정하고 주소는 지금 열린 origin으로 만든다. */
export function buildShareUrl(token: string): string {
  return `${window.location.origin}/s/${token}`;
}
