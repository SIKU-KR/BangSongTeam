/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** 빌드한 커밋의 짧은 SHA (`vite.config.ts`가 `GITHUB_SHA`로 채운다) */
  readonly VITE_APP_VERSION?: string;
}
