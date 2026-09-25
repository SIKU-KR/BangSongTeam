import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FolderIcon,
  ImageIcon,
  LogOutIcon,
  PresentationIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { Avatar, AvatarFallback, AvatarImage } from "#components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "#components/ui/sidebar";
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

function NavItem({
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
    <SidebarMenuItem ref={setNodeRef}>
      <SidebarMenuButton
        data-testid={item.testId}
        isActive={active}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        className={cn(isDropTarget && "ring-2 ring-sidebar-ring")}
      >
        <item.icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AccountMenuItem(): React.JSX.Element {
  const session = useSession();
  const [signingOut, setSigningOut] = useState(false);

  const name = session.user?.name ?? "사용자";

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <SidebarMenuItem data-testid="account-card">
      <SidebarMenuButton
        size="lg"
        disabled={signingOut}
        onClick={() => void handleSignOut()}
      >
        <Avatar>
          {session.user?.image && <AvatarImage src={session.user.image} />}
          <AvatarFallback>{name.slice(0, 2)}</AvatarFallback>
        </Avatar>
        <div className="grid flex-1 text-left leading-tight">
          <span className="truncate font-semibold">{name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {signingOut ? "로그아웃 중…" : "로그아웃"}
          </span>
        </div>
        <LogOutIcon />
      </SidebarMenuButton>
    </SidebarMenuItem>
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
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => navigate(drivePath(null))}
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <PresentationIcon />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">Worship Studio</span>
                <span className="truncate text-xs text-muted-foreground">
                  16:9 프레젠테이션 스튜디오
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NewMenuButton
          variant="sidebar"
          testId="sidebar-create-presentation-btn"
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="주 메뉴">
              <SidebarMenu>
                <NavItem
                  item={DRIVE_ITEM}
                  active={isDrive}
                  onClick={() => navigate(drivePath(null))}
                  drop={{ kind: "folder", folderId: null }}
                />
                <NavItem
                  item={BACKGROUNDS_ITEM}
                  active={isBackgrounds}
                  onClick={() => navigate(BACKGROUNDS_ITEM.path)}
                />
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <ThemeMenuButton />
          <AccountMenuItem />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
