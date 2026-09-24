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
 * 사용자 업로드의 R2 키.
 *
 * 21자 NanoID가 들어가 URL을 추측할 수 없다. 미디어 프록시는 인증 없이
 * 서빙하므로 이 키 자체가 접근 통제다 (`src/worker/routes/media.ts`).
 */
export function userBackgroundKeys(
  userId: string,
  backgroundId: string,
  mediaMime: BackgroundMimeType,
  posterMime: BackgroundImageMimeType | null,
): { mediaKey: string; posterKey: string } {
  const base = `uploads/${userId}/${backgroundId}`;
  const mediaKey = `${base}.${backgroundFileExtension(mediaMime)}`;
  return {
    mediaKey,
    posterKey: posterMime
      ? `${base}.poster.${backgroundFileExtension(posterMime)}`
      : mediaKey,
  };
}
