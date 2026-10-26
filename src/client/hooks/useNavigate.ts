import { useCallback } from "react";
import { useRouter } from "next/navigation";

export type NavigateFunction = (
  to: string,
  options?: { replace?: boolean },
) => void;

/**
 * 앱 안 주소로 옮기는 함수. 드라이브 동작·송출 시작처럼 이동을 함수로 넘겨받는 코드가
 * 라우터를 몰라도 되게 한다.
 */
export function useNavigate(): NavigateFunction {
  const router = useRouter();
  return useCallback(
    (to, options) => {
      if (options?.replace) router.replace(to);
      else router.push(to);
    },
    [router],
  );
}
