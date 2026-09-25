import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getPresentationById,
  replaceWithServerDocument,
} from "../features/presentation";
import {
  ShareLinkError,
  ShareLinkLoading,
} from "../features/sharing/ShareLinkStatus";
import {
  MAKE_COPY_STATE,
  SHARE_COPY_PARAM,
} from "../features/sharing/shareLink";
import { joinSharedPresentation } from "../lib/api/shareApi";
import { describeApiError } from "../lib/api/request";

/**
 * 로그인한 사람의 공유 링크(`/s/:token`) 진입.
 *
 * 서버에서 세트를 받아 로컬 스토어에 넣은 뒤 편집기로 보낸다. 한 번 들어오면
 * 드라이브의 "공유받은 항목"에 남고, 오프라인 송출도 내 세트처럼 된다.
 * 소유자가 자기 링크를 열면 로컬에 아직 안 올라간 변경을 덮지 않도록
 * 로컬 문서가 없을 때만 넣는다.
 *
 * 로그인 전에 '사본 만들기'를 눌러 로그인하고 돌아왔으면(`?copy=1`)
 * 편집기에서 사본 만들기 창을 바로 연다.
 */
export function ShareJoinRoute(): React.JSX.Element {
  const { token = "" } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const startedFor = useRef<string | null>(null);
  const continueCopy = searchParams.has(SHARE_COPY_PARAM);

  useEffect(() => {
    if (startedFor.current === token) return;
    startedFor.current = token;

    void (async () => {
      try {
        const joined = await joinSharedPresentation(token);
        if (
          joined.role !== "owner" ||
          !getPresentationById(joined.presentationId)
        ) {
          replaceWithServerDocument(joined.document);
        }
        navigate(`/editor/${joined.presentationId}`, {
          replace: true,
          state:
            continueCopy && joined.role === "viewer"
              ? MAKE_COPY_STATE
              : undefined,
        });
      } catch (err) {
        setError(describeApiError(err));
      }
    })();
  }, [token, navigate, continueCopy]);

  if (error) {
    return (
      <ShareLinkError
        message={error}
        actionLabel="내 프레젠테이션으로"
        onAction={() => navigate("/presentations", { replace: true })}
      />
    );
  }
  return <ShareLinkLoading />;
}
