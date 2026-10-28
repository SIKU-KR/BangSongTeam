/**
 * 배경 영상 검사 (`importBackgrounds.mjs`). ffprobe 결과만 받아 판단해 영상 파일 없이 시험한다.
 */

/** `ffprobe -show_entries`에 넘기는 값: 첫 영상 스트림의 코덱·프로필·픽셀 형식과 길이 */
export const PROBE_ENTRIES =
  "stream=codec_name,profile,pix_fmt:format=duration";

/**
 * ffprobe 결과의 영상 길이(초, 반올림). 길이를 읽지 못하면 등록을 멈춘다. NaN은 Firestore에
 * 그대로 남고 JSON으로는 null이 되어 앱이 그 배경을 버린다.
 */
export function durationOf(probed, file) {
  const durationSec = Math.round(Number(probed.format?.duration));
  if (!Number.isFinite(durationSec) || durationSec < 0) {
    throw new Error(`영상 길이를 읽지 못함: ${file}`);
  }
  return durationSec;
}

const PLAYABLE_PROFILES = new Set([
  "Constrained Baseline",
  "Baseline",
  "Main",
  "High",
]);

/**
 * ffprobe JSON(`-of json`)을 보고 브라우저가 재생할 수 있는 배경 영상인지 확인한다. 받으면 길이를
 * 초 단위로 돌려주고(`durationOf`), 아니면 던진다.
 *
 * 코덱 이름만 보면 10비트(High 10, `yuv420p10le`)나 4:2:2(`yuv422p`) H.264도 `h264`라 통과하는데,
 * Safari를 비롯한 Apple 기기와 많은 Chrome 환경은 이 영상을 풀지 못해 포스터나 검은 화면만
 * 보여 준다. 배경 파일은 키를 바꿀 수 없어 잘못 올리면 지우고 새 id로 다시 올려야 하고, 지우면
 * 그 배경을 쓰던 곡이 모두 배경 없음이 된다. 그래서 8비트 4:2:0(`yuv420p`)과 Baseline·Main·High
 * 프로필만 받는다.
 */
export function checkProbedVideo(probed, file) {
  const stream = probed.streams?.[0];
  const codec = stream?.codec_name;
  if (codec !== "h264") throw new Error(`H.264가 아닙니다 (${codec}): ${file}`);
  if (stream.pix_fmt !== "yuv420p" || !PLAYABLE_PROFILES.has(stream.profile)) {
    throw new Error(
      `브라우저가 재생하지 못하는 H.264예요 (${stream.profile}, ${stream.pix_fmt}). 8비트 4:2:0(yuv420p) High 프로필 이하로 다시 인코딩해 주세요: ${file}`,
    );
  }
  return durationOf(probed, file);
}
