import React, { useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useNavigate } from "#hooks/useNavigate";
import {
  FolderIcon,
  ImageIcon,
  LogOutIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#components/ui/alert-dialog";
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
import { useSession, signOut } from "../../lib/auth";
import { shouldConfirmSignOut } from "../../lib/sync";
import {
  DRIVE_ROOT_PATH,
  NewMenuButton,
  drivePath,
  isDrivePath,
  useDrive,
  useDriveDroppable,
} from "../../features/drive";
import { SHELL_COPY } from "#copy/shell";
import { COMMON_COPY } from "#copy/common";
import { AUTH_COPY } from "#copy/auth";
import { APP_NAME, APP_TAGLINE, FALLBACK_USER_NAME } from "#shared";

interface NavItem {
  testId: string;
  path: string;
  label: string;
  icon: LucideIcon;
}

const DRIVE_ITEM: NavItem = {
  testId: "sidebar-nav-home",
  path: DRIVE_ROOT_PATH,
  label: COMMON_COPY.myDrive,
  icon: FolderIcon,
};

const BACKGROUNDS_ITEM: NavItem = {
  testId: "sidebar-nav-backgrounds",
  path: "/backgrounds",
  label: SHELL_COPY.backgroundGallery,
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

/**
 * 계정 카드. 누르면 로그아웃한다. 오프라인이거나 서버에 보내지 못한 변경이 있으면 먼저 확인을 받는다.
 * 그 변경은 이 기기에 남아 같은 계정으로 다시 로그인할 때 올라가고, 다시 로그인하려면 인터넷이 필요하다.
 */
function AccountMenuItem(): React.JSX.Element {
  const session = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  const name = session.user?.name ?? FALLBACK_USER_NAME.default;

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      toast.error(AUTH_COPY.signOutFailed);
    } finally {
      setSigningOut(false);
    }
  };

  const handleClick = (): void => {
    if (shouldConfirmSignOut()) setConfirmingSignOut(true);
    else void handleSignOut();
  };

  return (
    <>
      <SidebarMenuItem data-testid="account-card">
        <SidebarMenuButton
          size="lg"
          disabled={signingOut}
          onClick={handleClick}
        >
          <Avatar>
            {session.user?.image && <AvatarImage src={session.user.image} />}
            <AvatarFallback>{name.slice(0, 2)}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate font-semibold">{name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {signingOut ? SHELL_COPY.signingOut : SHELL_COPY.signOut}
            </span>
          </div>
          <LogOutIcon />
        </SidebarMenuButton>
      </SidebarMenuItem>

      <AlertDialog open={confirmingSignOut} onOpenChange={setConfirmingSignOut}>
        <AlertDialogContent
          data-testid="sign-out-confirm-dialog"
          className="max-h-9/10 overflow-y-auto"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {SHELL_COPY.signOutConfirm.title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {SHELL_COPY.signOutConfirm.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{COMMON_COPY.cancel}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="sign-out-confirm-btn"
              onClick={() => {
                setConfirmingSignOut(false);
                void handleSignOut();
              }}
            >
              {SHELL_COPY.signOut}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * 좌측 내비게이션 사이드바.
 *
 * 드라이브에서 앱 이름이나 내 드라이브를 누르면 검색을 끝내고 루트를 연다. 루트에서 검색하던
 * 중이면 주소가 그대로라 검색어가 남기 때문이다. 배경 갤러리에서 누를 때는 비우지 않아, 같은
 * 위치로 돌아오면 두고 온 검색어를 이어 쓴다.
 */
export function AppSidebar(): React.JSX.Element {
  const navigate = useNavigate();
  const pathname = usePathname();
  const drive = useDrive();

  const isDrive = isDrivePath(pathname);
  const isBackgrounds =
    pathname === BACKGROUNDS_ITEM.path ||
    pathname.startsWith(`${BACKGROUNDS_ITEM.path}/`);

  const openMyDrive = (): void => {
    if (isDrive) drive.setSearchQuery("");
    navigate(drivePath(null));
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={openMyDrive}>
              <img
                src="/icons/icon-192.png"
                alt=""
                className="size-8 shrink-0"
              />
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{APP_NAME}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {APP_TAGLINE}
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
            <nav aria-label={SHELL_COPY.mainNav}>
              <SidebarMenu>
                <NavItem
                  item={DRIVE_ITEM}
                  active={isDrive}
                  onClick={openMyDrive}
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
          <AccountMenuItem />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
