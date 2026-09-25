import React from "react";
import { Card, CardContent } from "#components/ui/card";

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
    <Card>
      <CardContent className="space-y-0.5">
        {lines.map((line, idx) =>
          !line.trim() ? (
            <div key={idx} className="my-1 flex items-center gap-3 py-2">
              <span className="w-8 text-right text-2xs text-muted-foreground/60 select-none">
                {idx + 1}
              </span>
              <div className="flex flex-1 items-center justify-end border-b border-dashed">
                <span className="px-1 font-sans text-2xs text-muted-foreground">
                  [슬라이드 분할]
                </span>
              </div>
            </div>
          ) : (
            <div
              key={idx}
              className="-mx-1 flex items-start gap-3 rounded-sm px-1 hover:bg-muted/60"
            >
              <span className="w-8 shrink-0 pt-0.5 text-right text-2xs text-muted-foreground select-none">
                {idx + 1}
              </span>
              <span className="font-sans text-xs/relaxed">{line}</span>
            </div>
          ),
        )}
      </CardContent>
    </Card>
  );
}
