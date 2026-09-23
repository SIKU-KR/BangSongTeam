import React, { useState } from "react";
import type { CatalogCandidate } from "@repo/shared";
import { CatalogStatusBadge } from "./CatalogStatusBadge";

/** 사용자가 '목록에 없는 새 곡'을 고른 경우 */
export const NEW_SONG_CHOICE = "__new__";

export interface CatalogCandidateChooserProps {
  title: string;
  candidates: CatalogCandidate[];
  onChoose: (catalogId: string | null) => void;
  onBack: () => void;
}

/**
 * '이 곡이 맞나요?' (PRD 4.8 곡 식별).
 *
 * 같은 제목의 곡이 가사 라이브러리에 있을 때, 등록하려는 곡이 그중 하나인지
 * 사용자에게 묻는다. 고른 곡에 가사가 기여된다. 다른 곡이면 새 곡으로 등록한다.
 */
export function CatalogCandidateChooser({
  title,
  candidates,
  onChoose,
  onBack,
}: CatalogCandidateChooserProps): React.JSX.Element {
  const [selected, setSelected] = useState<string>(
    candidates.find((c) => c.exact)?.id ?? candidates[0]?.id ?? NEW_SONG_CHOICE,
  );

  return (
    <div
      data-testid="catalog-candidate-chooser"
      className="flex-1 flex flex-col p-6 overflow-y-auto space-y-4"
    >
      <div className="border-b border-zinc-200 dark:border-zinc-800 pb-3">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
          이 곡이 맞나요?
        </h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          가사 라이브러리에 &lsquo;{title}&rsquo;과(와) 같은 제목의 곡이
          있습니다. 같은 곡을 고르면 여러 사람의 가사를 모아 대표 가사를
          만듭니다.
        </p>
      </div>

      <div className="space-y-2">
        {candidates.map((candidate) => (
          <label
            key={candidate.id}
            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${
              selected === candidate.id
                ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <input
              type="radio"
              name="catalog-candidate"
              data-testid={`catalog-candidate-${candidate.id}`}
              checked={selected === candidate.id}
              onChange={() => setSelected(candidate.id)}
              className="mt-1 accent-emerald-600"
            />
            <span className="flex-1 min-w-0 space-y-1">
              <span className="flex items-center gap-2">
                <span className="text-xs font-bold truncate">
                  {candidate.title}
                </span>
                <span className="text-[11px] text-zinc-500 truncate">
                  {candidate.artist || "아티스트 미상"}
                </span>
                <CatalogStatusBadge
                  status={candidate.status}
                  versionCount={candidate.versionCount}
                />
              </span>
              {candidate.twoLinesPreview.map((line, i) => (
                <span
                  key={i}
                  className="block text-[11px] text-zinc-500 dark:text-zinc-400 truncate"
                >
                  {line}
                </span>
              ))}
            </span>
          </label>
        ))}

        <label
          className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${
            selected === NEW_SONG_CHOICE
              ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30"
              : "border-zinc-200 dark:border-zinc-800"
          }`}
        >
          <input
            type="radio"
            name="catalog-candidate"
            data-testid="catalog-candidate-new"
            checked={selected === NEW_SONG_CHOICE}
            onChange={() => setSelected(NEW_SONG_CHOICE)}
            className="accent-emerald-600"
          />
          <span className="text-xs font-semibold">
            목록에 없는 다른 곡입니다 (새 곡으로 등록)
          </span>
        </label>
      </div>

      <div className="pt-2 flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
        >
          ← 가사 입력으로
        </button>
        <button
          type="button"
          data-testid="catalog-candidate-confirm-btn"
          onClick={() =>
            onChoose(selected === NEW_SONG_CHOICE ? null : selected)
          }
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
        >
          이 선택으로 저장하고 추가
        </button>
      </div>
    </div>
  );
}

/**
 * 후보를 보여 줄 필요가 있는가.
 * 후보가 없거나, 제목·아티스트까지 같은 곡이 딱 하나뿐이면 묻지 않는다.
 */
export function needsCandidateChoice(candidates: CatalogCandidate[]): boolean {
  if (candidates.length === 0) return false;
  return !(candidates.length === 1 && candidates[0].exact);
}
