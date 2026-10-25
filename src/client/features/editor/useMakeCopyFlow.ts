import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { duplicatePresentation, editorPath } from "../presentation";
import { SHARE_COPY_PARAM } from "../sharing/shareLink";
import { EDITOR_COPY } from "#copy/editor";

interface UseMakeCopyFlowOptions {
  presentationId: string;
  onGuestRequest?: () => void;
}

interface MakeCopyFlow {
  isPickerOpen: boolean;
  open: () => void;
  confirm: (folderId: string | null) => void;
  cancel: () => void;
}

/**
 * 보기 전용 프레젠테이션의 '사본 만들기' 흐름. 사본을 만들면 그 편집기로 옮긴다.
 * 로그인하지 않은 사람은 사본이 계정에 남아야 하므로 폴더 선택 창 대신
 * `onGuestRequest`로 로그인부터 받는다.
 *
 * 공유 링크에서 로그인하고 돌아온 경우(주소의 사본 요청 `?copy=1`)에는 폴더 선택 창을
 * 처음부터 열어 둔다. 그 요청은 첫 렌더에서 읽은 뒤 주소에서 지워, 새로고침이나
 * 뒤로 가기로 창이 다시 열리지 않게 한다.
 */
export function useMakeCopyFlow({
  presentationId,
  onGuestRequest,
}: UseMakeCopyFlowOptions): MakeCopyFlow {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isRequested = searchParams.has(SHARE_COPY_PARAM);
  const [isPickerOpen, setIsPickerOpen] = useState(isRequested);

  useEffect(() => {
    if (!isRequested) return;
    const rest = new URLSearchParams(searchParams);
    rest.delete(SHARE_COPY_PARAM);
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [isRequested, searchParams, pathname, router]);

  const confirm = (folderId: string | null): void => {
    setIsPickerOpen(false);
    const copy = duplicatePresentation(presentationId, folderId);
    if (!copy) return;
    toast.success(EDITOR_COPY.copyDialog.created);
    router.push(editorPath(copy.id));
  };

  return {
    isPickerOpen,
    open: onGuestRequest ?? (() => setIsPickerOpen(true)),
    confirm,
    cancel: () => setIsPickerOpen(false),
  };
}
