import React from "react";
import { testRouter } from "./navigation";

/** `next/link` 테스트 대역. 누르면 `next/navigation` 대역의 주소를 바꾼다 */
export default function Link({
  href,
  replace,
  prefetch,
  onClick,
  children,
  ...anchorProps
}: React.ComponentProps<"a"> & {
  href: string;
  replace?: boolean;
  prefetch?: boolean;
}): React.JSX.Element {
  void prefetch;
  return (
    <a
      href={href}
      {...anchorProps}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (replace) testRouter.replace(href);
        else testRouter.push(href);
      }}
    >
      {children}
    </a>
  );
}
