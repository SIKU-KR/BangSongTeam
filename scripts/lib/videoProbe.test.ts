import { describe, expect, it } from "vitest";
import { PROBE_ENTRIES, checkProbedVideo, durationOf } from "./videoProbe.mjs";

const probed = (stream: Record<string, string>) => ({
  streams: [stream],
  format: { duration: "20.02" },
});

describe("checkProbedVideo", () => {
  it("ffprobe에 코덱과 함께 프로필·픽셀 형식을 묻는다", () => {
    expect(PROBE_ENTRIES).toBe(
      "stream=codec_name,profile,pix_fmt:format=duration",
    );
  });

  it("8비트 4:2:0 H.264는 받고 길이를 초 단위로 돌려준다", () => {
    for (const profile of [
      "Constrained Baseline",
      "Baseline",
      "Main",
      "High",
    ]) {
      expect(
        checkProbedVideo(
          probed({ codec_name: "h264", profile, pix_fmt: "yuv420p" }),
          "loop.mp4",
        ),
      ).toBe(20);
    }
  });

  it("브라우저가 풀지 못하는 10비트·4:2:2 H.264는 거절한다", () => {
    expect(() =>
      checkProbedVideo(
        probed({
          codec_name: "h264",
          profile: "High 10",
          pix_fmt: "yuv420p10le",
        }),
        "ten-bit.mp4",
      ),
    ).toThrow("ten-bit.mp4");
    expect(() =>
      checkProbedVideo(
        probed({
          codec_name: "h264",
          profile: "High 4:2:2",
          pix_fmt: "yuv422p",
        }),
        "four-two-two.mp4",
      ),
    ).toThrow("yuv422p");
  });

  it("H.264가 아니거나 영상 스트림이 없으면 거절한다", () => {
    expect(() =>
      checkProbedVideo(
        probed({ codec_name: "hevc", profile: "Main", pix_fmt: "yuv420p" }),
        "hevc.mp4",
      ),
    ).toThrow("hevc");
    expect(() =>
      checkProbedVideo({ streams: [], format: { duration: "1" } }, "x.mp4"),
    ).toThrow("x.mp4");
  });
});

describe("durationOf", () => {
  it("ffprobe가 준 길이를 초 단위 정수로 반올림한다", () => {
    expect(durationOf({ format: { duration: "19.6" } }, "loop.mp4")).toBe(20);
  });

  it.each([{ format: {} }, { format: { duration: "N/A" } }, {}])(
    "길이를 읽지 못하면(%j) 등록을 멈춘다",
    (probed) => {
      expect(() => durationOf(probed, "loop.mp4")).toThrow("loop.mp4");
    },
  );

  it("재생할 수 있는 영상이라도 길이를 읽지 못하면 받지 않는다", () => {
    expect(() =>
      checkProbedVideo(
        {
          streams: [
            { codec_name: "h264", profile: "High", pix_fmt: "yuv420p" },
          ],
          format: { duration: "N/A" },
        },
        "no-duration.mp4",
      ),
    ).toThrow("no-duration.mp4");
  });
});
