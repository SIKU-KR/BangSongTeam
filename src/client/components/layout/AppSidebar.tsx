import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FolderIcon,
  ImageIcon,
  PresentationIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "#components/ui/button";
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
  icon: LucideIcon;
}

const DRIVE_ITEM: NavItem = {
  testId: "sidebar-nav-home",
  path: DRIVE_ROOT_PATH,
  label: "내 드라이브",
  icon: FolderIcon,
};

const BACKGROUNDS_ITEM: NavItem = {
  testId: "sidebar-nav-backgrounds",
  path: "/backgrounds",
  label: "배경 갤러리",
  icon: ImageIcon,
};

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
    <Button
      ref={setNodeRef}
      variant="ghost"
      data-testid={item.testId}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "h-9 w-full justify-start gap-4 rounded-full pr-3 pl-4 font-normal text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active &&
          "bg-sidebar-accent font-semibold text-sidebar-accent-foreground",
        isDropTarget && "ring-2 ring-sidebar-ring ring-inset",
      )}
    >
      <item.icon className={cn("size-5", !active && "text-muted-foreground")} />
      {item.label}
    </Button>
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
      className="flex items-center gap-3 rounded-2xl border bg-card p-3 text-card-foreground"
    >
      {session.user?.image ? (
        <img
          src={session.user.image}
          alt=""
          className="size-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {initials}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold">{name}</p>
        <Button
          variant="link"
          size="xs"
          disabled={signingOut}
          onClick={() => void handleSignOut()}
          className="h-auto p-0 text-2xs text-muted-foreground"
        >
          {signingOut ? "로그아웃 중…" : "로그아웃"}
        </Button>
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
    <aside className="hidden h-full w-64 shrink-0 flex-col justify-between overflow-y-auto bg-sidebar py-4 pr-4 pl-3 text-sidebar-foreground lg:flex">
      <div className="space-y-6">
        <div className="flex items-center gap-3 px-2 pt-1">
          <div className="flex size-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
            <PresentationIcon className="size-5" />
          </div>
          <div>
            <span className="flex items-center gap-1.5 text-base font-extrabold tracking-tight">
              Worship Studio
            </span>
            <p className="text-2xs font-medium text-muted-foreground">
              16:9 프레젠테이션 스튜디오
            </p>
          </div>
        </div>

        <NewMenuButton
          variant="sidebar"
          testId="sidebar-create-presentation-btn"
        />

        <nav className="space-y-0.5" aria-label="주 메뉴">
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

      <div className="space-y-3 border-t border-sidebar-border pt-3">
        <ThemeMenuButton />
        <AccountCard />
      </div>
    </aside>
  );
}
