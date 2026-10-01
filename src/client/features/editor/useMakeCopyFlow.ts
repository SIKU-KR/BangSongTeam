import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { duplicatePresentation } from "../presentation";
import { editorPath } from "../presentation/fullscreen";
import { wantsMakeCopy } from "../sharing/shareLink";
import { EDITOR_COPY } from "#copy/editor";

interface UseMakeCopyFlowOptions {
  presentationId: string;
  onGuestRequest?: () => void;
}

export interface MakeCopyFlow {
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
 * 공유 링크에서 로그인하고 돌아온 경우(history state의 사본 요청)에는 폴더 선택 창을
 * 처음부터 열어 둔다. 그 요청은 첫 렌더에서 읽은 뒤 history에서 지워, 새로고침이나
 * 뒤로 가기로 창이 다시 열리지 않게 한다.
 */
export function useMakeCopyFlow({
  presentationId,
  onGuestRequest,
}: UseMakeCopyFlowOptions): MakeCopyFlow {
  const navigate = useNavigate();
  const location = useLocation();
  const [isPickerOpen, setIsPickerOpen] = useState(() =>
    wantsMakeCopy(location.state),
  );

  useEffect(() => {
    if (!wantsMakeCopy(location.state)) return;
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: null,
    });
  }, [location, navigate]);

  const confirm = (folderId: string | null): void => {
    setIsPickerOpen(false);
    const copy = duplicatePresentation(presentationId, folderId);
    if (!copy) return;
    toast.success(EDITOR_COPY.copyDialog.created);
    navigate(editorPath(copy.id));
  };

  return {
    isPickerOpen,
    open: onGuestRequest ?? (() => setIsPickerOpen(true)),
    confirm,
    cancel: () => setIsPickerOpen(false),
  };
}
