/** 내 드라이브 루트 경로. 폴더·휴지통 경로가 모두 이 아래에 있다 */
export const DRIVE_ROOT_PATH = "/presentations";
export const TRASH_PATH = `${DRIVE_ROOT_PATH}/trash`;

/** 폴더 화면 주소. `src/app/(shell)/presentations/folders/[folderId]` 라우트와 짝을 이룬다 */
export function drivePath(folderId: string | null | undefined): string {
  return folderId ? `${DRIVE_ROOT_PATH}/folders/${folderId}` : DRIVE_ROOT_PATH;
}

/** 드라이브 화면(루트·폴더·휴지통)인지. 셸이 드라이브 전용 헤더와 사이드바 강조를 고른다 */
export function isDrivePath(pathname: string): boolean {
  return (
    pathname === DRIVE_ROOT_PATH || pathname.startsWith(`${DRIVE_ROOT_PATH}/`)
  );
}
