import type {
  BackgroundImageMimeType,
  BackgroundMimeType,
} from "../constants/backgrounds";

/** 판별에 필요한 파일 앞부분 바이트 수 */
export const BACKGROUND_SNIFF_BYTES = 12;

function matches(
  bytes: Uint8Array,
  offset: number,
  signature: readonly number[],
): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

const ASCII_FTYP = [0x66, 0x74, 0x79, 0x70];
const ASCII_RIFF = [0x52, 0x49, 0x46, 0x46];
const ASCII_WEBP = [0x57, 0x45, 0x42, 0x50];
const JPEG_SOI = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * 파일 앞부분 바이트로 실제 형식을 판별한다.
 *
 * 브라우저가 붙인 `Content-Type`은 확장자만 보고 정해지므로 믿지 않는다.
 * 확장자만 바꾼 파일이 R2에 올라가면 송출 중 `<video>`가 재생하지 못한다.
 */
export function sniffBackgroundMimeType(
  bytes: Uint8Array,
): BackgroundMimeType | null {
  if (matches(bytes, 4, ASCII_FTYP)) return "video/mp4";
  if (matches(bytes, 0, JPEG_SOI)) return "image/jpeg";
  if (matches(bytes, 0, PNG_SIGNATURE)) return "image/png";
  if (matches(bytes, 0, ASCII_RIFF) && matches(bytes, 8, ASCII_WEBP)) {
    return "image/webp";
  }
  return null;
}

const EXTENSIONS: Record<BackgroundMimeType, string> = {
  "video/mp4": "mp4",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function backgroundFileExtension(mime: BackgroundMimeType): string {
  return EXTENSIONS[mime];
}

/**
 * 관리자가 앱에서 올린 기본 제공 배경의 R2 키.
 *
 * 운영 런북으로 등록하는 배경과 같은 접두사(`loops/`, `posters/`)를 쓴다. 이미지
 * 배경 원본은 `stills/`에 둔다. 포스터는 영상·이미지 모두 `posters/`에 두고, 포스터가
 * 없을 때만 원본을 포스터로 함께 쓴다. 21자 NanoID가 들어가 같은 제목의 배경을
 * 올려도 키가 겹치지 않는다.
 */
export function serviceBackgroundKeys(
  backgroundId: string,
  mediaMime: BackgroundMimeType,
  posterMime: BackgroundImageMimeType | null,
): { mediaKey: string; posterKey: string } {
  const mediaKey =
    mediaMime === "video/mp4"
      ? `loops/${backgroundId}.mp4`
      : `stills/${backgroundId}.${backgroundFileExtension(mediaMime)}`;
  const posterKey = posterMime
    ? `posters/${backgroundId}.${backgroundFileExtension(posterMime)}`
    : mediaKey;
  return { mediaKey, posterKey };
}
