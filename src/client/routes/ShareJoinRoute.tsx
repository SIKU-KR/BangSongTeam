import React, { useEffect, useRef, useState } from "react";
import { Link2Off, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "#components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#components/ui/empty";
import {
  getPresentationById,
  replaceWithServerDocument,
} from "../features/presentation";
import { joinSharedPresentation } from "../lib/api/shareApi";
import { describeApiError } from "../lib/api/request";

/**
 * 공유 링크(`/s/:token`) 진입.
 *
 * 서버에서 세트를 받아 로컬 스토어에 넣은 뒤 편집기로 보낸다. 한 번 들어오면
 * 드라이브의 "공유받은 항목"에 남고, 오프라인 송출도 내 세트처럼 된다.
 * 소유자가 자기 링크를 열면 로컬에 아직 안 올라간 변경을 덮지 않도록
 * 로컬 문서가 없을 때만 넣는다.
 */
export function ShareJoinRoute(): React.JSX.Element {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const startedFor = useRef<string | null>(null);

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
        navigate(`/editor/${joined.presentationId}`, { replace: true });
      } catch (err) {
        setError(describeApiError(err));
      }
    })();
  }, [token, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      {error ? (
        <Empty data-testid="share-join-error">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Link2Off />
            </EmptyMedia>
            <EmptyTitle>공유 세트를 열 수 없습니다</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => navigate("/presentations", { replace: true })}
            >
              내 프레젠테이션으로
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <p
          data-testid="share-join-loading"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="animate-spin" />
          공유받은 세트를 여는 중…
        </p>
      )}
    </div>
  );
}
