import { describe, it, expect, vi } from "vitest";
import { MutationObserver, QueryObserver } from "@tanstack/react-query";
import { API_ERRORS } from "#shared";
import { createAppQueryClient } from "./queryClient";
import { ServerRejectedError } from "./request";

function watchConsent(client: ReturnType<typeof createAppQueryClient>) {
  const queryFn = vi.fn(async () => ({ agreedAt: null }));
  const observer = new QueryObserver(client, {
    queryKey: ["consent", "user-1"],
    queryFn,
    staleTime: Infinity,
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  return { queryFn, unsubscribe };
}

function failWith(
  client: ReturnType<typeof createAppQueryClient>,
  error: Error,
): Promise<unknown> {
  return new MutationObserver(client, {
    mutationFn: async () => {
      throw error;
    },
  }).mutate();
}

describe("createAppQueryClient", () => {
  it("가입 동의가 필요하다는 403을 받으면 동의 상태를 다시 받아 동의 창을 띄운다", async () => {
    const client = createAppQueryClient();
    const { queryFn, unsubscribe } = watchConsent(client);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    await expect(
      failWith(
        client,
        new ServerRejectedError(403, API_ERRORS.consentRequired),
      ),
    ).rejects.toThrow(API_ERRORS.consentRequired);

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    unsubscribe();
  });

  it("다른 거절에는 동의 상태를 다시 받지 않는다", async () => {
    const client = createAppQueryClient();
    const { queryFn, unsubscribe } = watchConsent(client);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    await expect(
      failWith(
        client,
        new ServerRejectedError(403, API_ERRORS.deck.notAccessible),
      ),
    ).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
