import React from "react";

/**
 * 가사 원문 뷰어.
 */
export function LyricsViewer({
  lyrics,
}: {
  lyrics: string;
}): React.JSX.Element {
  const lines = lyrics.split("\n");
  return (
    <div className="space-y-0.5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {lines.map((line, idx) =>
        !line.trim() ? (
          <div key={idx} className="my-1 flex items-center gap-3 py-2">
            <span className="w-8 text-right text-[10px] text-zinc-300 select-none dark:text-zinc-700">
              {idx + 1}
            </span>
            <div className="flex flex-1 items-center justify-end border-b border-dashed border-zinc-200 dark:border-zinc-800">
              <span className="px-1 font-sans text-[9px] text-zinc-400 dark:text-zinc-600">
                [슬라이드 분할]
              </span>
            </div>
          </div>
        ) : (
          <div
            key={idx}
            className="-mx-1 flex items-start gap-3 rounded-sm px-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
          >
            <span className="w-8 shrink-0 pt-0.5 text-right text-[11px] text-zinc-400 select-none dark:text-zinc-600">
              {idx + 1}
            </span>
            <span className="font-sans text-xs/relaxed text-zinc-800 dark:text-zinc-200">
              {line}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
