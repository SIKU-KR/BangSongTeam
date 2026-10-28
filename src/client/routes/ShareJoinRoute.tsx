"use client";

import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "next/navigation";
import type { JoinShareResponse } from "#shared";
import { useNavigate } from "#hooks/useNavigate";
import { DRIVE_ROOT_PATH } from "../features/drive/drivePaths";
import {
  editorPath,
  getPresentationById,
  replaceWithServerDocument,
} from "../features/presentation";
import {
  forgetJoinedShare,
  recallJoinedShare,
  rememberJoinedShare,
} from "../features/sharing/joinedShares";
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
import {
  describeApiError,
  isRetryableApiError,
  ServerRejectedError,
} from "../lib/api/request";
import { useSession } from "../lib/auth";
import { SHARE_LINK_COPY } from "#copy/shareLink";

type JoinRole = JoinShareResponse["role"];

interface JoinFailure {
  message: string;
  canRetry: boolean;
}

function storedShareOf(
  userId: string,
  token: string,
): { presentationId: string; role: JoinRole } | null {
  const stored = getPresentationById(
    recallJoinedShare(userId, token) ?? undefined,
  );
  if (stored?.userId === userId) {
    return { presentationId: stored.id, role: "owner" };
  }
  if (stored?.access?.memberId === userId) {
    return { presentationId: stored.id, role: "viewer" };
  }
  return null;
}

function destinationOf(
  presentationId: string,
  role: JoinRole,
  continueCopy: boolean,
): string {
  const editor = editorPath(presentationId);
  return continueCopy && role === "viewer"
    ? withMakeCopyRequest(editor)
    : editor;
}

/**
 * 로그인한 사람의 공유 링크(`/s/:token`) 진입.
 *
 * 서버에서 세트를 받아 로컬 스토어에 넣은 뒤 편집기로 보낸다. 그 사본은 이 기기에 남지만 드라이브
 * 목록에는 나오지 않아, 다시 열 길은 같은 링크다. 서버에 닿지 못하거나 일시 장애면
 * (`isRetryableApiError`) 전에 이 링크로 참여해 둔 사본(`rememberJoinedShare`)으로 편집기를 연다.
 * 인터넷이 없는 예배실에서도 같은 링크로 송출하게 하려는 것이다. 서버가 링크를 열 수 없다고
 * 답하면(404) 사본이 있어도 열지 않고 기록을 지운다. 해제된 링크가 다시 열리면 안 된다. 이미 연
 * 사본의 해제는 편집기가 서버에 닿을 때 알아낸다(`refreshSharedPresentation`).
 *
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
 *
 * 오프라인이거나 서버가 잠시 응답하지 못해 열지 못했으면 '다시 시도'로 다시 참여한다.
 */
export function ShareJoinRoute(): React.JSX.Element {
  const { token = "" } = useParams<{ token?: string }>();
  const searchParams = useSearchParams();
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const userId = session.user?.userId ?? "";
  const consent = useConsentStatus(userId);
  const [failure, setFailure] = useState<JoinFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const startedFor = useRef<string | null>(null);
  const continueCopy = searchParams.has(SHARE_COPY_PARAM);
  const waitingForConsent =
    consent.data?.agreedAt === null ||
    (consent.isPending && consent.fetchStatus === "fetching");

  useEffect(() => {
    if (waitingForConsent) return;
    const run = `${token}:${attempt}`;
    if (startedFor.current === run) return;
    startedFor.current = run;

    void (async () => {
      try {
        const joined = await joinSharedPresentation(token);
        if (
          joined.role !== "owner" ||
          !getPresentationById(joined.presentationId)
        ) {
          replaceWithServerDocument(joined.document);
        }
        rememberJoinedShare(userId, token, joined.presentationId);
        navigate(
          destinationOf(joined.presentationId, joined.role, continueCopy),
          { replace: true },
        );
      } catch (err) {
        if (isConsentRequiredError(err)) {
          startedFor.current = null;
          void refreshConsentStatus(queryClient);
        }
        if (err instanceof ServerRejectedError && err.status === 404) {
          forgetJoinedShare(userId, token);
        }
        const canRetry = isRetryableApiError(err);
        const stored = canRetry ? storedShareOf(userId, token) : null;
        if (stored) {
          navigate(
            destinationOf(stored.presentationId, stored.role, continueCopy),
            { replace: true },
          );
          return;
        }
        setFailure({ message: describeApiError(err), canRetry });
      }
    })();
  }, [
    token,
    attempt,
    navigate,
    continueCopy,
    waitingForConsent,
    queryClient,
    userId,
  ]);

  if (failure) {
    return (
      <ShareLinkError
        message={failure.message}
        actionLabel={SHARE_LINK_COPY.goToPresentations}
        onAction={() => navigate(DRIVE_ROOT_PATH, { replace: true })}
        onRetry={
          failure.canRetry
            ? () => {
                setFailure(null);
                setAttempt((count) => count + 1);
              }
            : undefined
        }
      />
    );
  }
  return <ShareLinkLoading />;
}
