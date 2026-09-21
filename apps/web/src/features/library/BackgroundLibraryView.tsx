import React, { useState } from "react";
import {
  INITIAL_BACKGROUNDS,
  getBackgroundMediaUrl,
  getBackgroundPosterUrl,
  hangulIncludes,
} from "@repo/shared";
import {
  INITIAL_MY_BACKGROUNDS,
  type CustomBackgroundItem,
} from "./mockCommunityData";

export interface BackgroundLibraryViewProps {
  onApplyBackgroundToCurrentSet?: (backgroundId: string) => void;
  searchQuery?: string;
}

const FILTER_TAGS = [
  "전체",
  "잔잔한",
  "밝은",
  "웅장한",
  "따뜻한",
  "차가운",
  "어두운",
] as const;

/**
 * '배경 라이브러리' 화면 컴포넌트
 * - 단락 1: 내가 등록한 배경 (My Backgrounds)
 * - 단락 2: 유저가 등록한 배경 (Community / Public Loops)
 */
export function BackgroundLibraryView({
  onApplyBackgroundToCurrentSet,
  searchQuery = "",
}: BackgroundLibraryViewProps): React.JSX.Element {
  const [myBackgrounds, setMyBackgrounds] = useState<CustomBackgroundItem[]>(
    INITIAL_MY_BACKGROUNDS,
  );
  const [isRegisterOpen, setIsRegisterOpen] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>("");
  const [newMediaUrl, setNewMediaUrl] = useState<string>("");
  const [newTag, setNewTag] = useState<string>("잔잔한");

  const [activeTag, setActiveTag] = useState<string>("전체");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [appliedBgId, setAppliedBgId] = useState<string | null>(null);

  const query = searchQuery.trim();

  // 내가 등록한 배경 필터링 (es-hangul 초성/자모 검색 지원)
  const filteredMyBackgrounds = myBackgrounds.filter((bg) => {
    if (!query) return true;
    return (
      hangulIncludes(bg.title, query) ||
      bg.tags.some((t) => hangulIncludes(t, query))
    );
  });

  // 유저가 등록한 배경(공개 루프) 필터링 (es-hangul 초성/자모 검색 지원)
  const filteredCommunityBackgrounds = INITIAL_BACKGROUNDS.filter((bg) => {
    const matchesTag = activeTag === "전체" || bg.tags.includes(activeTag);
    if (!matchesTag) return false;
    if (!query) return true;
    return (
      hangulIncludes(bg.title, query) ||
      bg.tags.some((t) => hangulIncludes(t, query))
    );
  });

  const handleApply = (bgId: string): void => {
    if (onApplyBackgroundToCurrentSet) {
      onApplyBackgroundToCurrentSet(bgId);
    }
    setAppliedBgId(bgId);
    setTimeout(() => {
      setAppliedBgId(null);
    }, 2000);
  };

  const handleRegisterBackground = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const newItem: CustomBackgroundItem = {
      id: `my-bg-${Date.now()}`,
      title: newTitle.trim(),
      mediaUrl: newMediaUrl.trim() || "/api/media/loops/warm_light_flow.mp4",
      posterUrl: "/api/media/posters/warm_light_flow.webp",
      type: "video",
      createdAt: new Date().toISOString(),
      tags: [newTag],
    };

    setMyBackgrounds((prev) => [newItem, ...prev]);
    setNewTitle("");
    setNewMediaUrl("");
    setIsRegisterOpen(false);
  };

  const handleDeleteMyBackground = (id: string): void => {
    setMyBackgrounds((prev) => prev.filter((bg) => bg.id !== id));
  };

  return (
    <div className="space-y-10">
      {/* ───────────────────────────────────────────────
          단락 1: 내가 등록한 배경 (My Backgrounds)
          ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h2 className="text-xl font-bold text-white tracking-tight">
                내가 등록한 배경
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono font-medium">
                {filteredMyBackgrounds.length}개 배경
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              교회 본당 환경에 맞춰 직접 업로드하거나 등록한 커스텀 영상/이미지 배경입니다.
            </p>
          </div>

          <button
            type="button"
            data-testid="register-custom-bg-btn"
            onClick={() => setIsRegisterOpen(true)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/40 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto transition-all"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            <span>새 배경 등록하기</span>
          </button>
        </div>

        {filteredMyBackgrounds.length === 0 ? (
          <div className="py-12 text-center flex flex-col items-center justify-center gap-3 bg-zinc-900/40 border border-zinc-800 rounded-xl">
            <p className="text-sm font-semibold text-zinc-300">
              {query
                ? `"${searchQuery}"에 일치하는 등록 배경이 없습니다.`
                : "등록된 커스텀 배경이 없습니다."}
            </p>
            {!query && (
              <button
                type="button"
                onClick={() => setIsRegisterOpen(true)}
                className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-emerald-400 text-xs font-medium cursor-pointer transition-colors"
              >
                교회 맞춤 배경 등록하기
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filteredMyBackgrounds.map((bg) => {
              const isHovered = hoveredId === bg.id;

              return (
                <div
                  key={bg.id}
                  data-testid={`my-bg-card-${bg.id}`}
                  onMouseEnter={() => setHoveredId(bg.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="group relative flex flex-col bg-zinc-900/60 hover:bg-zinc-900/90 border border-zinc-800/80 hover:border-zinc-700 rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-xl hover:shadow-black/40 hover:-translate-y-0.5"
                >
                  <div className="relative aspect-video w-full bg-black overflow-hidden select-none rounded-t-2xl">
                    {isHovered ? (
                      <video
                        src={bg.mediaUrl}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : bg.posterUrl ? (
                      <img
                        src={bg.posterUrl}
                        alt={bg.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-zinc-600 text-xs">
                        미리보기 없음
                      </div>
                    )}

                    <div className="absolute top-2 left-2 z-30">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-black/80 backdrop-blur-md text-emerald-400 border border-emerald-500/30">
                        내 배경
                      </span>
                    </div>

                    <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2 p-3">
                      <button
                        type="button"
                        onClick={() => handleDeleteMyBackground(bg.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-red-950/80 hover:bg-red-900 text-red-300 text-xs font-medium border border-red-800/80 cursor-pointer shadow-md"
                      >
                        삭제
                      </button>
                    </div>
                  </div>

                  <div className="p-3 bg-zinc-900/90 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-white truncate">
                        {bg.title}
                      </h4>
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                        {bg.tags.join(", ")}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500 uppercase px-1.5 py-0.5 rounded bg-zinc-800">
                      {bg.type}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* 새 배경 추가 점선 카드 */}
            <div
              onClick={() => setIsRegisterOpen(true)}
              className="group border-2 border-dashed border-zinc-800 hover:border-emerald-500/60 rounded-xl flex flex-col items-center justify-center p-6 min-h-[170px] cursor-pointer transition-all bg-zinc-950/40 hover:bg-zinc-900/30"
            >
              <div className="w-10 h-10 rounded-full bg-zinc-900 group-hover:bg-emerald-950/60 border border-zinc-700/80 group-hover:border-emerald-500/50 flex items-center justify-center text-zinc-400 group-hover:text-emerald-400 transition-colors mb-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <span className="text-xs font-semibold text-zinc-300 group-hover:text-white transition-colors">
                새 배경 영상/이미지 등록
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ───────────────────────────────────────────────
          단락 2: 유저가 등록한 배경 (Community / Public Loops)
          ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
              <h2 className="text-xl font-bold text-white tracking-tight">
                유저가 등록한 배경
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-sky-950 text-sky-400 border border-sky-800 font-mono font-medium">
                10종 고화질 모션 루프
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              사역팀에서 가장 많이 활용되는 무음 H.264 고화질 비디오 루프입니다. 마우스를 올리면 미리보기가 재생됩니다.
            </p>
          </div>

          {/* 태그 필터 버튼 그룹 */}
          <div className="flex items-center gap-1.5 overflow-x-auto self-start sm:self-auto py-1">
            {FILTER_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(tag)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all shrink-0 cursor-pointer ${
                  activeTag === tag
                    ? "bg-sky-600 text-white shadow-md shadow-sky-950/40"
                    : "bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {filteredCommunityBackgrounds.length === 0 ? (
          <div className="py-12 text-center flex flex-col items-center justify-center gap-2 bg-zinc-900/40 border border-zinc-800 rounded-xl">
            <p className="text-sm font-semibold text-zinc-300">
              "{searchQuery}"에 일치하는 배경이 없습니다.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filteredCommunityBackgrounds.map((bg) => {
              const videoUrl = getBackgroundMediaUrl(bg.id);
              const posterUrl = getBackgroundPosterUrl(bg.id);
              const isHovered = hoveredId === bg.id;
              const isApplied = appliedBgId === bg.id;

              return (
                <div
                  key={bg.id}
                  data-testid={`community-bg-card-${bg.id}`}
                  onMouseEnter={() => setHoveredId(bg.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="group relative flex flex-col bg-zinc-900/60 hover:bg-zinc-900/90 border border-zinc-800/80 hover:border-zinc-700 rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-xl hover:shadow-black/40 hover:-translate-y-0.5"
                >
                  <div className="relative aspect-video w-full bg-black overflow-hidden select-none rounded-t-2xl">
                    {isHovered && videoUrl ? (
                      <video
                        src={videoUrl}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : posterUrl ? (
                      <img
                        src={posterUrl}
                        alt={bg.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-zinc-600 text-xs">
                        포스터 없음
                      </div>
                    )}

                    <div className="absolute top-2 left-2 z-30">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-black/80 backdrop-blur-md text-sky-400 border border-sky-500/30">
                        {bg.tags[0] ?? "루프"}
                      </span>
                    </div>

                    <div className="absolute top-2 right-2 z-30">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-300 bg-black/80">
                        {bg.durationSec}s
                      </span>
                    </div>

                    {/* 호버 오버레이 */}
                    <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2 p-3">
                      <button
                        type="button"
                        onClick={() => handleApply(bg.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-md transition-all active:scale-95 cursor-pointer flex items-center gap-1 ${
                          isApplied
                            ? "bg-emerald-600 text-white"
                            : "bg-sky-600 hover:bg-sky-500 text-white"
                        }`}
                      >
                        {isApplied ? (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>적용 완료!</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>현재 곡에 적용</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="p-3 bg-zinc-900/90 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-white truncate">
                        {bg.title}
                      </h4>
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                        {bg.tags.join(" · ")}
                      </p>
                    </div>

                    <button
                      type="button"
                      data-testid={`apply-community-bg-${bg.id}`}
                      onClick={() => handleApply(bg.id)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all shrink-0 cursor-pointer ${
                        isApplied
                          ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                          : "bg-zinc-800 hover:bg-zinc-700 text-sky-300 hover:text-white border border-zinc-700/80"
                      }`}
                    >
                      {isApplied ? "적용됨 ✓" : "적용"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 새 배경 등록 모달 */}
      {isRegisterOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-5 text-zinc-100">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>새 배경 영상 등록</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsRegisterOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleRegisterBackground} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  배경 제목 *
                </label>
                <input
                  type="text"
                  required
                  placeholder="예: 우리 교회 메인 비디오 루프"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-xl px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  미디어 URL (선택)
                </label>
                <input
                  type="text"
                  placeholder="비디오/이미지 URL (비워두면 기본 루프 적용)"
                  value={newMediaUrl}
                  onChange={(e) => setNewMediaUrl(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-xl px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  분위기 태그
                </label>
                <select
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="잔잔한">잔잔한</option>
                  <option value="밝은">밝은</option>
                  <option value="웅장한">웅장한</option>
                  <option value="따뜻한">따뜻한</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRegisterOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-md cursor-pointer"
                >
                  등록하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
