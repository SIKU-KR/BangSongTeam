"use client";

import React, { useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useNavigate } from "#hooks/useNavigate";
import { DRIVE_ROOT_PATH } from "../features/drive/drivePaths";
import {
  showSharedPreview,
  usePresentationById,
} from "../features/presentation";
import {
  ShareLinkError,
  ShareLinkLoading,
} from "../features/sharing/ShareLinkStatus";
import {
  SHARE_COPY_PARAM,
  shareCopyPath,
  sharePath,
} from "../features/sharing/shareLink";
import { useSharePreview } from "../lib/api/shareQueries";
import { describeApiError, isRetryableApiError } from "../lib/api/request";
import { refreshBackgroundCatalog } from "../lib/sync";
import { EditorRoute } from "./EditorRoute";
import { LoginRoute } from "./LoginRoute";
import { SHARE_LINK_COPY } from "#copy/shareLink";

/**
 * 로그인하지 않은 사람의 공유 링크(`/s/:token`).
 *
 * 멤버로 기록하지 않고 세트를 메모리에만 넣어 보기 전용 편집기로 보여 준다.
 * 발표도 된다. 사본은 내 계정에 남는 일이라 '사본 만들기'를 누르면 같은
 * 주소에 `?copy=1`을 붙여 로그인 화면을 띄운다. 로그인하면 이 주소로 돌아와
 * `ShareJoinRoute`가 사본 만들기 창을 이어서 연다.
 *
 * 링크를 열지 못했을 때의 '로그인하기'는 손님에게 로그인 화면이 바로 열리는 내 프레젠테이션
 * 주소로 보낸다. 랜딩(`/`)에는 로그인 화면이 없다. 오프라인이거나 서버가 잠시 응답하지 못한
 * 실패는 '다시 시도'로 링크를 다시 불러온다.
 */
export function SharePreviewRoute(): React.JSX.Element {
  const { token = "" } = useParams<{ token?: string }>();
  const searchParams = useSearchParams();
  const navigate = useNavigate();
  const preview = useSharePreview(token);
  const document = preview.data;
  const shown = usePresentationById(document?.id);

  useEffect(() => {
    if (document) showSharedPreview(document);
  }, [document]);

  useEffect(() => {
    void refreshBackgroundCatalog();
  }, []);

  if (searchParams.has(SHARE_COPY_PARAM)) {
    return (
      <LoginRoute
        description={SHARE_LINK_COPY.signInToCopy}
        onCancel={() => navigate(sharePath(token), { replace: true })}
      />
    );
  }

  if (!document && preview.error) {
    return (
      <ShareLinkError
        message={describeApiError(preview.error)}
        actionLabel={SHARE_LINK_COPY.signIn}
        onAction={() => navigate(DRIVE_ROOT_PATH, { replace: true })}
        onRetry={
          isRetryableApiError(preview.error)
            ? () => void preview.refetch()
            : undefined
        }
      />
    );
  }

  if (!document || !shown?.access) return <ShareLinkLoading />;

  return (
    <EditorRoute
      guest={{
        presentationId: document.id,
        returnPath: sharePath(token),
        onRequestCopy: () => navigate(shareCopyPath(token)),
      }}
    />
  );
}
