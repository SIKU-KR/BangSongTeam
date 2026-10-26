"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 그리는 즉시 다른 주소로 바꾼다. 지금 주소는 방문 기록에 남기지 않는다 */
export function Navigate({ to }: { to: string }): null {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
