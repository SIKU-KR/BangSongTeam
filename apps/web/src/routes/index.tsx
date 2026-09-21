import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChromeAlertBanner,
  isGoogleChromeBrowser,
} from "../components/common/ChromeAlertBanner";
import { QuickLyricPasteModal } from "../features/editor";
import {
  useActiveSetlist,
  addDeckToSetlist,
} from "../features/presentation";
import type { Deck } from "@repo/shared";

/**
 * M1 메인 홈 진입 화면 (HomeRoute)
 * - 상단: Chrome 브라우저 환경 권장 알림 배너
 * - M1 송출 시작하기 (5곡+ 세트) 카드: /present/fullscreen 으로 즉시 전환 (비-Chrome 진입 시 확인 창)
 * - 가사 빠른 입력 카드: 찬양 가사 붙여넣기 모달(실시간 분할 & 멜론/벅스 검색 링크) 실행 -> 인메모리 세트 즉시 추가
 * - 검증용 세트리스트 구성 실시간 연동
 */
export function HomeRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const setlist = useActiveSetlist();
  const [isQuickPasteOpen, setIsQuickPasteOpen] = useState<boolean>(false);

  const handleStartPresentation = (): void => {
    if (!isGoogleChromeBrowser()) {
      const proceed = window.confirm(
        "이 서비스는 Google Chrome에 최적화되어 있습니다. 예배 송출은 Chrome에서 진행하는 것을 권장합니다.\n\n계속 진행하시겠습니까?",
      );
      if (!proceed) {
        return;
      }
    }
    navigate("/present/fullscreen");
  };

  const handleAddToSet = (newDeck: Deck): void => {
    addDeckToSetlist(newDeck);
    setIsQuickPasteOpen(false);
  };


  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* 1. 상단 비Chrome 경고 배너 */}
      <ChromeAlertBanner />

      {/* 2. 메인 컨텐츠 영역 */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-12 flex flex-col gap-10">
        {/* 헤더 */}
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800">
              Milestone M1 Ready
            </span>
            <span className="text-xs text-zinc-500 font-mono">
              Zero-Network Offline Verified
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Worship Slide
          </h1>
          <p className="text-base text-zinc-400 max-w-2xl leading-relaxed">
            가볍고 빠른 교회 예배팀을 위한 웹 슬라이드 송출 시스템입니다.
            전체화면 송출, 비디오 모션 루프, 100ms 미만 반응의 키패드 점프를
            경험해보세요.
          </p>
        </header>

        {/* 핵심 작업 카드 그리드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 카드 1: M1 송출 시작하기 */}
          <div className="bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 transition-colors rounded-xl p-6 flex flex-col justify-between shadow-xl">
            <div className="space-y-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-900/50 border border-emerald-700/50 flex items-center justify-center text-emerald-400">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">
                  M1 송출 시작하기 (5곡 세트)
                </h2>
                <p className="text-sm text-zinc-400 mt-1 leading-relaxed">
                  검증용 5곡 세트리스트(은혜로다, 주 품에, 시선, 꽃들도, 주의
                  이름 높이며)를 전체화면으로 즉시 송출합니다.
                </p>
              </div>

              {/* 단축키 팁 */}
              <div className="bg-zinc-950/60 rounded-lg p-3 text-xs text-zinc-400 space-y-1.5 border border-zinc-800/80 font-mono">
                <div className="flex justify-between">
                  <span className="text-zinc-500">다음/이전 슬라이드</span>
                  <span className="text-zinc-300">Space, ▶ / ◀</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">암전 (Blackout)</span>
                  <span className="text-zinc-300">B</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">가사 숨김</span>
                  <span className="text-zinc-300">H</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">곡/슬라이드 점프</span>
                  <span className="text-zinc-300">N.M + Enter</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              data-testid="start-present-btn"
              onClick={handleStartPresentation}
              className="mt-6 w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 cursor-pointer"
            >
              <span>송출 시작하기</span>
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
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>

          {/* 카드 2: 가사 빠른 입력 */}
          <div className="bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 transition-colors rounded-xl p-6 flex flex-col justify-between shadow-xl">
            <div className="space-y-4">
              <div className="w-10 h-10 rounded-lg bg-indigo-900/50 border border-indigo-700/50 flex items-center justify-center text-indigo-400">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">
                  가사 빠른 입력
                </h2>
                <p className="text-sm text-zinc-400 mt-1 leading-relaxed">
                  웹이나 메모장에서 복사한 찬양 가사를 붙여넣고 16:9 슬라이드로
                  실시간 분할 및 정제합니다. 멜론 및 벅스 검색 링크도
                  제공됩니다.
                </p>
              </div>

              {/* 특징 태그 */}
              <div className="flex flex-wrap gap-2 pt-2">
                <span className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 text-xs">
                  빈 줄 기준 슬라이드 분할
                </span>
                <span className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 text-xs">
                  4줄 초과 시 2줄 자동 분할
                </span>
                <span className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 text-xs">
                  멜론/벅스 가사 검색
                </span>
                <span className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 text-xs">
                  16:9 슬라이드 미리보기
                </span>
              </div>
            </div>

            <button
              type="button"
              data-testid="open-quick-paste-btn"
              onClick={() => setIsQuickPasteOpen(true)}
              className="mt-6 w-full py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>가사 입력 열기</span>
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
            </button>
          </div>
        </div>

        {/* 3. 오늘 예배 세트리스트 미리보기 (실시간 연동) */}
        <section className="bg-zinc-900/50 border border-zinc-800/70 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              {setlist.title} ({setlist.items.length}곡 준비 완료)
            </h3>
            <span className="text-xs text-zinc-500 font-mono">
              예배 일자: {setlist.serviceDate}
            </span>
          </div>

          <div className="divide-y divide-zinc-800/60">
            {setlist.items.map((item, index) => (
              <div
                key={item.id}
                className="py-3 flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center text-xs font-mono">
                    {index + 1}
                  </span>
                  <div>
                    <span className="font-medium text-zinc-200">
                      {item.deck?.title ?? "제목 없음"}
                    </span>
                    <span className="text-xs text-zinc-500 ml-2">
                      {item.deck?.artist ?? ""}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400 font-mono bg-zinc-800/80 px-2 py-0.5 rounded">
                    {item.deck?.slides.length ?? 0} 슬라이드
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* 가사 빠른 입력 모달 */}
      <QuickLyricPasteModal
        isOpen={isQuickPasteOpen}
        onClose={() => setIsQuickPasteOpen(false)}
        onAddToSet={handleAddToSet}
      />

    </div>
  );
}

export default HomeRoute;
