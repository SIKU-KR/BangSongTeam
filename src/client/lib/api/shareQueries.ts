import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LinkAccess, ShareSettings } from "#shared";
import {
  fetchSharePreview,
  fetchShareSettings,
  resetShareLink,
  updateShareSettings,
} from "./shareApi";

export const shareKeys = {
  settings: (id: string) => ["presentation-share", id] as const,
  preview: (token: string) => ["share-preview", token] as const,
};

export function useSharePreview(token: string) {
  return useQuery({
    queryKey: shareKeys.preview(token),
    queryFn: () => fetchSharePreview(token),
    retry: false,
  });
}

export function useShareSettings(id: string, options: { enabled: boolean }) {
  return useQuery({
    queryKey: shareKeys.settings(id),
    queryFn: () => fetchShareSettings(id),
    enabled: options.enabled,
  });
}

export function useUpdateShareSettings(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (access: LinkAccess) => updateShareSettings(id, access),
    onSuccess: (settings: ShareSettings) => {
      queryClient.setQueryData(shareKeys.settings(id), settings);
    },
  });
}

export function useResetShareLink(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => resetShareLink(id),
    onSuccess: (settings: ShareSettings) => {
      queryClient.setQueryData(shareKeys.settings(id), settings);
    },
  });
}
