/**
 * bangsongteam.siku-labs.com을 Cloud Run 서비스로 넘기는 프록시.
 *
 * 서울 리전은 Cloud Run 도메인 매핑을 지원하지 않고, Cloudflare 무료 플랜은 프록시의 Host
 * 헤더를 바꿀 수 없어 DNS만으로는 run.app에 붙지 않는다. 그래서 Worker가 같은 경로로 run.app에
 * 요청한다.
 *
 * - 사용자 IP는 비밀값과 함께 넘긴다. 서버(`src/server/lib/clientIp.ts`)가 비밀값을 확인한 뒤에만
 *   이 IP로 빈도 제한을 건다.
 * - 배경 미디어(`/api/media/*`)는 키가 바뀌지 않으므로 Cloudflare에 캐시해 GCP 송신을 줄인다.
 *   캐시 키는 쿼리 문자열까지 포함한 URL이라 `?r=<난수>`만 붙여도 매번 원본에서 영상을 받게
 *   된다. 미디어 라우트는 쿼리를 쓰지 않으므로 캐시하는 요청에서는 쿼리를 뗀다.
 * - 응답의 `location`이 run.app을 가리키면 공개 도메인으로 바꾼다.
 */

const MEDIA_PREFIX = "/api/media/";

const proxy = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const publicOrigin = url.origin;
    url.protocol = "https:";
    url.host = env.ORIGIN_HOST;

    const headers = new Headers(request.headers);
    headers.set("x-bst-proxy-secret", env.PROXY_SECRET);
    headers.set(
      "x-bst-client-ip",
      request.headers.get("cf-connecting-ip") ?? "",
    );
    headers.set("x-forwarded-host", new URL(publicOrigin).host);
    headers.set("x-forwarded-proto", "https");

    const cacheable =
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname.startsWith(MEDIA_PREFIX);
    if (cacheable) url.search = "";

    const response = await fetch(url, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
      cf: cacheable ? { cacheEverything: true } : undefined,
    });

    const location = response.headers.get("location");
    const originPrefix = `https://${env.ORIGIN_HOST}`;
    if (!location?.startsWith(originPrefix)) return response;

    const rewritten = new Response(response.body, response);
    rewritten.headers.set(
      "location",
      publicOrigin + location.slice(originPrefix.length),
    );
    return rewritten;
  },
};

export default proxy;
