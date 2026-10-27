/**
 * 공유 라이브러리의 공식 곡을 올린 계정의 사용자 id. 운영 시드(`scripts/seedSelected.mjs`)와
 * 개발 시드(`db/seed/devSeed.ts`)가 같은 id를 쓴다. 곡 응답의 `userId`가 `IdSchema`(21자)를
 * 통과해야 해서 21자다.
 *
 * 공개 곡 카드의 공식 표시(`PublicDeckSummary.official`)는 이름이 아니라 이 id로만 정한다.
 * 이름은 누구나 비슷하게 지을 수 있다.
 */
export const OFFICIAL_LIBRARY_USER_ID = "bot-seed-official-lib";
