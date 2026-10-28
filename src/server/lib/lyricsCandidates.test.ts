import { describe, expect, it } from "vitest";
import { rankLyricsCandidates } from "./lyricsCandidates";

const row = (id: string, title: string, artist: string) => ({
  id,
  title,
  artist,
});

describe("rankLyricsCandidates", () => {
  it("같은 곡의 중복 등록을 묶어 곡 번호를 모으고 많이 등록된 쪽을 앞세운다", () => {
    const candidates = rankLyricsCandidates(
      [
        row("1", "은혜 은혜", "정소영"),
        row("2", "은혜  은혜!", "정소영"),
        row("3", "은혜 은혜", "박진희"),
        row("2", "은혜 은혜", "정소영"),
      ],
      { title: "은혜 은혜" },
    );

    expect(candidates).toEqual([
      { title: "은혜 은혜", artist: "정소영", ids: ["1", "2"] },
      { title: "은혜 은혜", artist: "박진희", ids: ["3"] },
    ]);
  });

  it("제목 일치, 시작, 포함 순으로 앞세우고 가수가 맞으면 점수를 더한다", () => {
    const candidates = rankLyricsCandidates(
      [
        row("1", "나의 은혜", "가"),
        row("2", "은혜 위에 은혜", "나"),
        row("3", "은혜", "다"),
        row("4", "은혜", "예수전도단"),
      ],
      { title: "은혜", artist: "예수전도단" },
    );

    expect(candidates.map((c) => c.ids[0])).toEqual(["4", "3", "2", "1"]);
  });

  it("가수가 일부만 맞으면 일치보다 낮게 더한다", () => {
    const candidates = rankLyricsCandidates(
      [row("1", "은혜", "다른이"), row("2", "은혜", "예수전도단 화요모임")],
      { title: "은혜", artist: "예수전도단" },
    );

    expect(candidates.map((c) => c.ids[0])).toEqual(["2", "1"]);
  });

  it("신청곡 표기와 트랙 번호가 붙은 mp3 제목을 정리하고 같은 곡으로 묶는다", () => {
    const candidates = rankLyricsCandidates(
      [
        row("1", "주저하는 연인들을 위해", "잔나비"),
        row("2", "020. 잔나비 - 주저하는 연인들을 위해.mp3", "잔나비"),
        row("3", "(꽃천사루루님)잔나비", "잔나비"),
        row("4", "잔나비", "(사느기님청)잔나비"),
      ],
      { title: "잔나비" },
    );

    expect(candidates).toEqual([
      { title: "잔나비", artist: "잔나비", ids: ["3", "4"] },
      { title: "주저하는 연인들을 위해", artist: "잔나비", ids: ["1", "2"] },
    ]);
  });

  it("제목이 비는 행은 버리고 후보는 10개, 곡 번호는 5개까지만 둔다", () => {
    const rows = [
      row("0", "(a님)", "x"),
      ...Array.from({ length: 7 }, (_, i) =>
        row(`${100 + i}`, "같은 곡", "가수"),
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        row(`${i + 1}`, `곡 ${i}`, "가수"),
      ),
    ];

    const candidates = rankLyricsCandidates(rows, { title: "같은 곡" });

    expect(candidates).toHaveLength(10);
    expect(candidates.find((c) => c.title === "같은 곡")?.ids).toHaveLength(5);
  });
});
