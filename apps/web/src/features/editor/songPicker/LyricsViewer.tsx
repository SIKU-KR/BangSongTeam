import React from "react";

/**
 * 가사 원문 뷰어: 줄 번호와 빈 줄 기준 슬라이드 분할선을 보여 준다.
 * 곡 추가 모달이 내 곡·공유 곡 전문을 같은 모양으로 그린다.
 */
export function LyricsViewer({
  lyrics,
}: {
  lyrics: string;
}): React.JSX.Element {
  const lines = lyrics.split("\n");
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm space-y-0.5">
      {lines.map((line, idx) =>
        !line.trim() ? (
          <div key={idx} className="flex items-center gap-3 py-2 my-1">
            <span className="w-8 text-right text-[10px] text-zinc-300 dark:text-zinc-700 select-none">
              {idx + 1}
            </span>
            <div className="flex-1 border-b border-dashed border-zinc-200 dark:border-zinc-800 flex items-center justify-end">
              <span className="text-[9px] text-zinc-400 dark:text-zinc-600 px-1 font-sans">
                [슬라이드 분할]
              </span>
            </div>
          </div>
        ) : (
          <div
            key={idx}
            className="flex items-start gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 rounded px-1 -mx-1"
          >
            <span className="w-8 text-right text-[11px] text-zinc-400 dark:text-zinc-600 select-none shrink-0 pt-0.5">
              {idx + 1}
            </span>
            <span className="text-zinc-800 dark:text-zinc-200 font-sans text-xs leading-relaxed">
              {line}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
