"use client";

import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "next/navigation";
import { useNavigate } from "#hooks/useNavigate";
import { DRIVE_ROOT_PATH } from "../features/drive/drivePaths";
import {
  editorPath,
  getPresentationById,
  replaceWithServerDocument,
} from "../features/presentation";
import {
  ShareLinkError,
  ShareLinkLoading,
} from "../features/sharing/ShareLinkStatus";
import {
  SHARE_COPY_PARAM,
  withMakeCopyRequest,
} from "../features/sharing/shareLink";
import { joinSharedPresentation } from "../lib/api/shareApi";
import {
  isConsentRequiredError,
  refreshConsentStatus,
  useConsentStatus,
} from "../lib/api/consentQueries";
import { describeApiError } from "../lib/api/request";
import { useSession } from "../lib/auth";
import { SHARE_LINK_COPY } from "#copy/shareLink";

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
 *
 * 링크로 처음 가입한 사람은 동의 모달이 떠 있는 동안 참여하지 않고 동의를 마친 뒤 참여한다.
 * 서버가 동의 전 참여를 막기 때문이다. 동의 상태를 확인하지 못하면(오프라인 등) 기다리지 않고
 * 서버가 정하게 두고, 서버가 동의 전이라 거절하면 동의 상태를 다시 받아 모달을 띄운 뒤 동의하면
 * 다시 참여한다.
 */
export function ShareJoinRoute(): React.JSX.Element {
  const { token = "" } = useParams<{ token?: string }>();
  const searchParams = useSearchParams();
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const consent = useConsentStatus(session.user?.userId ?? "");
  const [error, setError] = useState<string | null>(null);
  const startedFor = useRef<string | null>(null);
  const continueCopy = searchParams.has(SHARE_COPY_PARAM);
  const waitingForConsent =
    consent.data?.agreedAt === null ||
    (consent.isPending && consent.fetchStatus === "fetching");

  useEffect(() => {
    if (waitingForConsent) return;
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
        const editor = editorPath(joined.presentationId);
        navigate(
          continueCopy && joined.role === "viewer"
            ? withMakeCopyRequest(editor)
            : editor,
          { replace: true },
        );
      } catch (err) {
        if (isConsentRequiredError(err)) {
          startedFor.current = null;
          void refreshConsentStatus(queryClient);
        }
        setError(describeApiError(err));
      }
    })();
  }, [token, navigate, continueCopy, waitingForConsent, queryClient]);

  if (error) {
    return (
      <ShareLinkError
        message={error}
        actionLabel={SHARE_LINK_COPY.goToPresentations}
        onAction={() => navigate(DRIVE_ROOT_PATH, { replace: true })}
      />
    );
  }
  return <ShareLinkLoading />;
}
