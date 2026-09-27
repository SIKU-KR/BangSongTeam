/**
 * 폴더 저장소가 쓰는 문구. 폴더 저장소는 첫 로드 청크에 있고 번들러는 모듈 단위로
 * 청크를 나누므로, 드라이브 화면 문구(drive.ts)와 파일을 나눠야 첫 로드가 가볍다.
 */
export const FOLDER_COPY = {
  newFolder: "새 폴더",
  nameRequired: "이름을 입력해 주세요",
  nameTooLong: (max: number) => `이름은 ${max}자까지 쓸 수 있어요`,
  nameTaken: "같은 이름의 폴더가 이미 있어요",
  folderNotFound: "폴더를 찾을 수 없어요",
  targetFolderNotFound: "옮길 폴더를 찾을 수 없어요",
  cannotMoveIntoSelf: "폴더를 자기 안으로 옮길 수 없어요",
} as const;
