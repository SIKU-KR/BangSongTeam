import {
  ConsentStatusResponseSchema,
  type AgreeConsentRequest,
  type ConsentStatusResponse,
} from "#shared";
import { api } from "./client";
import { callApi } from "./request";

export async function fetchConsentStatus(): Promise<ConsentStatusResponse> {
  const body = await callApi(() => api.api.consent.$get());
  return ConsentStatusResponseSchema.parse(body);
}

export async function agreeConsent(
  input: AgreeConsentRequest,
): Promise<ConsentStatusResponse> {
  const body = await callApi(() => api.api.consent.$post({ json: input }));
  return ConsentStatusResponseSchema.parse(body);
}
