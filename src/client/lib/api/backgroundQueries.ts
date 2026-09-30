import { useMutation } from "@tanstack/react-query";
import { removeCatalogBackground } from "../../features/backgrounds/backgroundCatalog";
import { deleteBackground } from "./backgroundApi";

/**
 * 지운 배경을 로컬 카탈로그에서도 뺀다. 그 배경을 쓰던 모든 사용자의 곡은 서버에서
 * 배경 없음이 되고, 로컬에서도 카탈로그에 없으니 배경 없이 그려진다.
 */
export function useDeleteBackground() {
  return useMutation({
    mutationFn: deleteBackground,
    onSuccess: async (_result, id) => {
      await removeCatalogBackground(id);
    },
  });
}
