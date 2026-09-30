/**
 * 로컬 개발용 시드 계정. `pnpm db:seed:local`이 로컬 D1에 만들고, `pnpm dev`의
 * 로그인 화면이 OAuth 없이 이 계정으로 들어가는 버튼을 보여 준다.
 *
 * id는 `IdSchema`(21자)를 통과해야 한다. 운영 D1에는 이 계정이 없고, 개발용
 * 로그인 엔드포인트는 운영 번들에서 빠진다(`src/worker/lib/devSignIn.ts`).
 */
export const DEV_USERS = [
  {
    id: "devuser-owner-0000001",
    name: "김예배",
    email: "owner@dev.local",
    termsAgreed: true,
  },
  {
    id: "devuser-member-000001",
    name: "이찬양",
    email: "member@dev.local",
    termsAgreed: true,
  },
  {
    id: "devuser-newbie-000001",
    name: "박새신자",
    email: "newbie@dev.local",
    termsAgreed: false,
  },
] as const;

export type DevUser = (typeof DEV_USERS)[number];
