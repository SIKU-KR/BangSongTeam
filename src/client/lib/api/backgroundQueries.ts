import { useMutation } from "@tanstack/react-query";
import {
  addUploadedBackground,
  removeUploadedBackground,
} from "../../features/backgrounds/backgroundCatalog";
import { deleteUserBackground, uploadBackground } from "./backgroundApi";

/** 올린 배경을 곧바로 로컬 카탈로그(내 배경 맨 앞)에 넣는다 */
export function useUploadBackground() {
  return useMutation({
    mutationFn: uploadBackground,
    onSuccess: async ({ background, usage }) => {
      await addUploadedBackground(background, usage);
    },
  });
}

/**
 * 지운 배경을 로컬 카탈로그에서도 뺀다. 그 배경을 쓰던 곡은 서버에서
 * 배경 없음이 되고, 로컬에서도 카탈로그에 없으니 배경 없이 그려진다.
 */
export function useDeleteBackground() {
  return useMutation({
    mutationFn: deleteUserBackground,
    onSuccess: async ({ usage }, id) => {
      await removeUploadedBackground(id, usage);
    },
  });
}
