import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ThemeMenuButton } from "../common/ThemeMenuButton";
import { useSession, signOut } from "../../lib/auth";
import {
  DRIVE_ROOT_PATH,
  NewMenuButton,
  drivePath,
  useDriveDroppable,
} from "../../features/drive";

interface NavItem {
  testId: string;
  path: string;
  label: string;
  accent: string;
  iconPath: string;
}

const DRIVE_ITEM: NavItem = {
  testId: "sidebar-nav-home",
  path: DRIVE_ROOT_PATH,
  label: "내 드라이브",
  accent: "text-emerald-500 dark:text-emerald-400",
  iconPath:
    "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
};

const BACKGROUNDS_ITEM: NavItem = {
  testId: "sidebar-nav-backgrounds",
  path: "/backgrounds",
  label: "배경 갤러리",
  accent: "text-sky-500 dark:text-sky-400",
  iconPath:
    "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
};

const NAV_BUTTON_BASE =
  "w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-3 transition-all cursor-pointer border";
const NAV_ACTIVE =
  "bg-zinc-100 dark:bg-zinc-800/90 text-zinc-900 dark:text-white font-semibold shadow-sm border-zinc-300 dark:border-zinc-700/60";
const NAV_IDLE =
  "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900/60 border-transparent";
const NAV_DROP =
  "ring-2 ring-emerald-500/70 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-transparent";

function NavButton({
  item,
  active,
  onClick,
  drop,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
  drop?: Parameters<typeof useDriveDroppable>[1];
}): React.JSX.Element {
  const { setNodeRef, isDropTarget } = useDriveDroppable(
    `nav:${item.testId}`,
    drop ?? { kind: "trash" },
    !drop,
  );
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-testid={item.testId}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`${NAV_BUTTON_BASE} ${
        isDropTarget ? NAV_DROP : active ? NAV_ACTIVE : NAV_IDLE
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
}

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

/** 좌측 내비게이션 사이드바 */
export function AppSidebar(): React.JSX.Element {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isDrive =
    pathname === DRIVE_ROOT_PATH || pathname.startsWith(`${DRIVE_ROOT_PATH}/`);
  const isBackgrounds =
    pathname === BACKGROUNDS_ITEM.path ||
    pathname.startsWith(`${BACKGROUNDS_ITEM.path}/`);

  return (
    <aside className="w-64 h-full bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-900 hidden lg:flex flex-col justify-between p-4 shrink-0 overflow-y-auto">
      <div className="space-y-6">
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

        <NewMenuButton
          variant="sidebar"
          testId="sidebar-create-presentation-btn"
        />

        <nav className="space-y-1" aria-label="주 메뉴">
          <NavButton
            item={DRIVE_ITEM}
            active={isDrive}
            onClick={() => navigate(drivePath(null))}
            drop={{ kind: "folder", folderId: null }}
          />
          <NavButton
            item={BACKGROUNDS_ITEM}
            active={isBackgrounds}
            onClick={() => navigate(BACKGROUNDS_ITEM.path)}
          />
        </nav>
      </div>

      <div className="space-y-3 pt-3 border-t border-zinc-200 dark:border-zinc-900">
        <ThemeMenuButton />
        <AccountCard />
      </div>
    </aside>
  );
}
