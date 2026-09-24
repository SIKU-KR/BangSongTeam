import {
  BACKGROUND_UPLOAD_LIMITS,
  isBackgroundImageMimeType,
  isBackgroundVideoMimeType,
  type BackgroundKind,
} from "#shared";

export interface ProbedBackgroundFile {
  kind: BackgroundKind;
  width: number;
  height: number;
  durationSec: number;
  /** 영상의 첫 화면. 목록·썸네일이 영상을 받지 않고 그리게 한다 */
  poster?: File;
  /** 1920×1080 미만: 막지 않고 송출 시 흐려질 수 있다고만 알린다 */
  isLowResolution: boolean;
}

const POSTER_WIDTH = 960;
const POSTER_SEEK_SEC = 1;
const MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${Number((bytes / MB).toFixed(1))}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/**
 * 올리기 전에 형식·크기를 확인한다. 통과하면 null.
 * 서버도 같은 한도로 다시 검사하지만, 30MB를 다 올린 뒤에 거절당하지 않게 한다.
 */
export function checkBackgroundFile(file: File): string | null {
  if (
    !isBackgroundVideoMimeType(file.type) &&
    !isBackgroundImageMimeType(file.type)
  ) {
    return "MP4 영상이나 JPEG·PNG·WebP 이미지만 올릴 수 있습니다";
  }
  if (file.size > BACKGROUND_UPLOAD_LIMITS.maxFileBytes) {
    return `파일 하나는 ${formatBytes(BACKGROUND_UPLOAD_LIMITS.maxFileBytes)} 이하만 올릴 수 있습니다 (지금 ${formatBytes(file.size)})`;
  }
  return null;
}

function isLowResolution(width: number, height: number): boolean {
  return (
    width < BACKGROUND_UPLOAD_LIMITS.recommendedWidth ||
    height < BACKGROUND_UPLOAD_LIMITS.recommendedHeight
  );
}

function once(target: EventTarget, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (): void => {
      target.removeEventListener(event, onEvent);
      reject(new Error(event));
    };
    const onEvent = (): void => {
      target.removeEventListener("error", onError);
      resolve();
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

async function drawPoster(video: HTMLVideoElement): Promise<File> {
  const scale = Math.min(1, POSTER_WIDTH / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.8),
  );
  if (!blob || blob.size > BACKGROUND_UPLOAD_LIMITS.maxPosterBytes) {
    throw new Error("poster");
  }
  const extension = blob.type === "image/webp" ? "webp" : "png";
  return new File([blob], `poster.${extension}`, { type: blob.type });
}

async function probeVideo(file: File): Promise<ProbedBackgroundFile> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  try {
    video.src = url;
    await once(video, "loadeddata");
    const durationSec = Number.isFinite(video.duration) ? video.duration : 0;
    video.currentTime = Math.min(POSTER_SEEK_SEC, durationSec / 2);
    await once(video, "seeked");
    return {
      kind: "video",
      width: video.videoWidth,
      height: video.videoHeight,
      durationSec: Math.round(durationSec),
      poster: await drawPoster(video),
      isLowResolution: isLowResolution(video.videoWidth, video.videoHeight),
    };
  } catch {
    throw new Error(
      "이 브라우저에서 재생할 수 없는 영상입니다. H.264 코덱의 MP4로 바꿔 올려 주세요",
    );
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function probeImage(file: File): Promise<ProbedBackgroundFile> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    return {
      kind: "image",
      width: image.naturalWidth,
      height: image.naturalHeight,
      durationSec: 0,
      isLowResolution: isLowResolution(image.naturalWidth, image.naturalHeight),
    };
  } catch {
    throw new Error(
      "이미지를 열 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 브라우저가 실제로 재생·표시할 수 있는지 확인하고, 해상도·길이를 읽고,
 * 영상이면 포스터를 만든다. 송출 화면과 같은 Chrome 디코더로 확인하므로
 * 여기서 열리지 않는 파일은 예배 중에도 재생되지 않는다.
 */
export function probeBackgroundFile(file: File): Promise<ProbedBackgroundFile> {
  return isBackgroundVideoMimeType(file.type)
    ? probeVideo(file)
    : probeImage(file);
}
