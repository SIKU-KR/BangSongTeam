"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const NOTICE_TOAST_ID = "navigate-notice";

/**
 * 그리는 즉시 다른 주소로 바꾼다. 지금 주소는 방문 기록에 남기지 않는다.
 *
 * `notice`가 있으면 옮기면서 알림으로 까닭을 알린다. 사용자가 연 주소가 아닌 곳으로 보내는 일이라
 * 말없이 옮기면 왜 다른 화면인지 알 수 없다. 개발 모드가 이펙트를 두 번 돌려도 하나만 뜨도록
 * 알림 id를 고정한다.
 */
export function Navigate({
  to,
  notice,
}: {
  to: string;
  notice?: string;
}): null {
  const router = useRouter();
  useEffect(() => {
    if (notice) toast.info(notice, { id: NOTICE_TOAST_ID });
    router.replace(to);
  }, [router, to, notice]);
  return null;
}
