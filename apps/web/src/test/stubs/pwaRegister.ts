/**
 * `virtual:pwa-register` 테스트 대역.
 *
 * vite-plugin-pwa가 만들어 주는 가상 모듈은 vitest 설정에 존재하지 않는다.
 * 실제 등록 동작은 브라우저에서만 의미가 있으므로, 테스트에서는 아무것도 하지
 * 않는 등록기로 대체하고 `registerServiceWorker(registrar)` 주입 인자로
 * 상태 전이를 검증한다.
 */
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return async () => {};
}
