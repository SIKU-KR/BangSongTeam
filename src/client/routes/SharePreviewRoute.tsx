import React, { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  showSharedPreview,
  usePresentationById,
} from "../features/presentation";
import {
  ShareLinkError,
  ShareLinkLoading,
} from "../features/sharing/ShareLinkStatus";
import { SHARE_COPY_PARAM, shareCopyPath } from "../features/sharing/shareLink";
import { useSharePreview } from "../lib/api/shareQueries";
import { describeApiError } from "../lib/api/request";
import { refreshBackgroundCatalog } from "../lib/sync";
import { EditorRoute, LoginRoute, preloadEditorRoute } from "./lazyRoutes";

/**
 * 로그인하지 않은 사람의 공유 링크(`/s/:token`).
 *
 * 멤버로 기록하지 않고 세트를 메모리에만 넣어 보기 전용 편집기로 보여 준다.
 * 발표도 된다. 사본은 내 계정에 남는 일이라 '사본 만들기'를 누르면 같은
 * 주소에 `?copy=1`을 붙여 로그인 화면을 띄운다. 로그인하면 이 주소로 돌아와
 * `ShareJoinRoute`가 사본 만들기 창을 이어서 연다.
 */
export function SharePreviewRoute(): React.JSX.Element {
  const { token = "" } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const preview = useSharePreview(token);
  const document = preview.data;
  const shown = usePresentationById(document?.id);

  useEffect(() => {
    if (document) showSharedPreview(document);
  }, [document]);

  useEffect(() => {
    void refreshBackgroundCatalog();
    preloadEditorRoute();
  }, []);

  if (searchParams.has(SHARE_COPY_PARAM)) {
    return (
      <LoginRoute
        description="로그인하면 이 세트의 사본을 내 드라이브에 만들어 고칠 수 있습니다."
        onCancel={() => navigate(`/s/${token}`, { replace: true })}
      />
    );
  }

  if (!document && preview.error) {
    return (
      <ShareLinkError
        message={describeApiError(preview.error)}
        actionLabel="로그인하기"
        onAction={() => navigate("/", { replace: true })}
      />
    );
  }

  if (!document || !shown?.access) return <ShareLinkLoading />;

  return (
    <EditorRoute
      guest={{
        presentationId: document.id,
        returnPath: `/s/${token}`,
        onRequestCopy: () => navigate(shareCopyPath(token)),
      }}
    />
  );
}
