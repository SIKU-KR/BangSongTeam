import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ThemeMenuButton } from "../common/ThemeMenuButton";
import { useSession, signOut } from "../../lib/auth";

export interface AppSidebarProps {
  onCreateNewPresentation: () => void;
}

interface NavItem {
  testId: string;
  path: string;
  label: string;
  /** 활성 상태일 때의 아이콘 강조 색 */
  accent: string;
  iconPath: string;
}

/**
 * 메뉴 정의. `data-testid`는 경로 개편 전 이름을 유지한다 —
 * 기존 테스트가 이 id로 사이드바를 찾으므로 테스트 diff를 줄이는 편이 이득이다.
 */
const NAV_ITEMS: NavItem[] = [
  {
    testId: "sidebar-nav-home",
    path: "/presentations",
    label: "홈 (모든 프로젝트)",
    accent: "text-emerald-500 dark:text-emerald-400",
    iconPath:
      "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
  },
  {
    testId: "sidebar-nav-backgrounds",
    path: "/backgrounds",
    label: "배경 라이브러리",
    accent: "text-sky-500 dark:text-sky-400",
    iconPath:
      "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
  },
];

/**
 * Canva Projects 스타일 좌측 내비게이션 사이드바
 * - 브랜드 블록, 새 프레젠테이션 CTA, 경로 기반 메뉴 3종, 테마 전환, 프로필 카드
 * - 활성 상태는 `useLocation().pathname` 에서 파생되며 `aria-current="page"` 로도 노출된다
 */
/**
 * 로그인한 사용자와 로그아웃.
 *
 * 예전에는 '주일 찬양팀 / 로컬 오프라인 모드'라고 적힌 정적 아바타였다.
 */
function AccountCard(): React.JSX.Element {
  const session = useSession();
  const [signingOut, setSigningOut] = useState(false);

  const name = session.user?.name ?? "사용자";
  const initials = name.slice(0, 2);

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div
      data-testid="account-card"
      className="p-3 rounded-2xl bg-zinc-100/90 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-900 flex items-center gap-3"
    >
      {session.user?.image ? (
        <img
          src={session.user.image}
          alt=""
          className="w-9 h-9 rounded-full object-cover shrink-0"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-700 to-teal-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
          {initials}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate">
          {name}
        </p>
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void handleSignOut()}
          className="text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors disabled:opacity-60"
        >
          {signingOut ? "로그아웃 중…" : "로그아웃"}
        </button>
      </div>
    </div>
  );
}

export function AppSidebar({
  onCreateNewPresentation,
}: AppSidebarProps): React.JSX.Element {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isActive = (path: string): boolean =>
    pathname === path || pathname.startsWith(`${path}/`);

  return (
    <aside className="w-64 h-full bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-900 hidden lg:flex flex-col justify-between p-4 shrink-0 overflow-y-auto">
      <div className="space-y-6">
        {/* 브랜드 로고 & 워크스페이스 */}
        <div className="flex items-center gap-3 px-2 pt-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 via-teal-400 to-indigo-500 flex items-center justify-center text-white shadow-sm dark:shadow-emerald-950/40">
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
            </svg>
          </div>
          <div>
            <span className="text-base font-extrabold tracking-tight text-zinc-900 dark:text-white flex items-center gap-1.5">
              Worship Studio
            </span>
            <p className="text-[10px] text-zinc-500 font-medium">
              16:9 프레젠테이션 스튜디오
            </p>
          </div>
        </div>

        {/* Canva 스타일 새 디자인 만들기 메인 버튼 */}
        <button
          type="button"
          data-testid="sidebar-create-presentation-btn"
          onClick={onCreateNewPresentation}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-xs shadow-sm hover:shadow-md hover:shadow-emerald-600/20 dark:shadow-emerald-950/50 flex items-center justify-center gap-2 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
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
              strokeWidth={2.5}
              d="M12 4v16m8-8H4"
            />
          </svg>
          <span>새 프레젠테이션</span>
        </button>

        {/* 메인 사이드바 메뉴 (Canva 캡슐형 Pill 활성 인디케이터) */}
        <div className="space-y-1">
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  type="button"
                  data-testid={item.testId}
                  aria-current={active ? "page" : undefined}
                  onClick={() => navigate(item.path)}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-3 transition-all cursor-pointer ${
                    active
                      ? "bg-zinc-100 dark:bg-zinc-800/90 text-zinc-900 dark:text-white font-semibold shadow-sm border border-zinc-300 dark:border-zinc-700/60"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900/60"
                  }`}
                >
                  <div
                    className={`w-5 h-5 flex items-center justify-center ${
                      active ? item.accent : "text-zinc-400"
                    }`}
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
                        d={item.iconPath}
                      />
                    </svg>
                  </div>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* 좌측 하단 영역: 테마 전환 메뉴 + 사용자 프로필 */}
      <div className="space-y-3 pt-3 border-t border-zinc-200 dark:border-zinc-900">
        {/* 사이드바 하단 라이트/다크/시스템 설정 전환 메뉴버튼 */}
        <ThemeMenuButton />

        {/* 좌측 하단 사용자 프로필 (Canva 아바타 스타일) */}
        <AccountCard />
      </div>
    </aside>
  );
}
