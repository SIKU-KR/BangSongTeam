/**
 * 요청한 브라우저의 IP. Cloud Run 앞단(Google Front End)이 `x-forwarded-for`에 붙여 준다.
 *
 * 첫 값을 쓴다. 클라이언트가 이 헤더를 직접 보내면 첫 값을 바꿀 수 있어, 빈도 제한 같은
 * 최선 노력 방어에만 쓴다. 뒤쪽 값은 앞단 구성(로드 밸런서 유무)에 따라 달라 모든 요청이
 * 같은 키로 묶일 수 있다.
 */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
