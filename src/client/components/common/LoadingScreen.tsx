"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { isProjectionPath } from "../../features/presentation/fullscreen";

const VARIANT_CLASS = {
  screen: "min-h-dvh bg-background",
  content: "min-h-0 flex-1",
} as const;

/**
 * 불러오는 동안 보이는 화면. `screen`은 화면 전체를, `content`는 드라이브 셸의 본문 자리만
 * 채운다. 셸 안에서 기다릴 때 사이드바·헤더까지 가리면 화면이 깜박인다.
 *
 * 송출 주소에서는 글자 없이 검게만 그린다. 송출 중 새로고침하는 동안 프로젝터가 흰 화면으로
 * 번쩍이면 안 된다.
 */
export function LoadingScreen({
  testId,
  variant = "screen",
  children,
}: {
  testId: string;
  variant?: keyof typeof VARIANT_CLASS;
  children: React.ReactNode;
}): React.JSX.Element {
  const pathname = usePathname();
  if (isProjectionPath(pathname)) {
    return (
      <div data-testid={testId} role="status" className="min-h-dvh bg-black">
        <span className="sr-only">{children}</span>
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      role="status"
      className={cn(
        "flex items-center justify-center text-sm text-muted-foreground",
        VARIANT_CLASS[variant],
      )}
    >
      {children}
    </div>
  );
}
