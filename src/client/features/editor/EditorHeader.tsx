import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  CopyIcon,
  FileTextIcon,
  InfoIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Redo2Icon,
  Share2Icon,
  Undo2Icon,
  UsersIcon,
} from "lucide-react";
import { cn } from "cn";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#components/ui/dropdown-menu";
import { Input } from "#components/ui/input";
import { Kbd } from "#components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#components/ui/popover";
import { Separator } from "#components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";
import { IconButton } from "#components/common/IconButton";
import { usePersistenceError } from "../../lib/storage";
import { useSyncStatus } from "../../lib/sync";
import { ThemeMenuButton } from "../../components/common/ThemeMenuButton";
import { PRESENTATION_SHORTCUTS, type PresentationAccess } from "#shared";
import { EDITOR_SHORTCUT_GUIDE } from "./editorShortcuts";

const PRESENTATION_SHORTCUT_GUIDE: ReadonlyArray<{
  keys: string;
  action: string;
}> = [
  { keys: "→ / Space / PageDown", action: "다음 슬라이드" },
  { keys: "← / PageUp", action: "이전 슬라이드" },
  { keys: "번호 + Enter", action: "세트 전체 N번째 슬라이드로 이동" },
  { keys: "Backspace", action: "입력 중인 마지막 숫자 지우기" },
  { keys: "B", action: "블랙아웃 켜기/끄기" },
  { keys: "H", action: "가사 숨기기 (배경 유지)" },
  { keys: "Esc", action: "전체화면 해제 (송출 종료)" },
];

const NUMBER_JUMP_RULES: ReadonlyArray<string> = [
  "번호는 곡이 바뀌어도 이어서 셉니다. 1곡이 5장이면 2곡 첫 장은 6번입니다.",
  "숫자를 입력한 뒤 Enter를 눌러야 이동합니다.",
  `${PRESENTATION_SHORTCUTS.BUFFER_CLEAR_TIMEOUT_MS / 1000}초 동안 입력이 없으면 입력한 번호가 지워집니다.`,
  "없는 번호는 무시합니다.",
  "입력 중인 번호는 청중 화면에 표시되지 않습니다.",
];

export interface EditorHeaderProps {
  title: string;
  onUpdateTitle: (newTitle: string) => void;
  onPresent: () => void;
  totalSongs: number;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onNewPresentation?: () => void;
  onOpenLyricModal?: () => void;
  /** 공유받은 세트에만 넘긴다. 파일 메뉴에 '사본 만들기'를 더한다 */
  onMakeCopy?: () => void;
  /** 소유자에게만 넘긴다. 없으면 공유 버튼을 그리지 않는다 */
  onShare?: () => void;
  /** 공유받은 세트면 누가 어떤 권한으로 공유했는지 보여 준다 */
  sharedAccess?: PresentationAccess;
  /** 보기 권한 세트. 제목을 고칠 수 없다 */
  readOnly?: boolean;
  backPath?: string;
  className?: string;
}

function SaveStatusIndicator(): React.JSX.Element {
  const persistenceError = usePersistenceError();
  const { status } = useSyncStatus();

  const { dotClass, label } = (() => {
    if (persistenceError) {
      return { dotClass: "bg-destructive", label: "저장 실패" };
    }
    switch (status) {
      case "syncing":
        return { dotClass: "bg-warning", label: "동기화 중…" };
      case "synced":
        return { dotClass: "bg-success", label: "동기화됨" };
      case "offline":
        return {
          dotClass: "bg-muted-foreground",
          label: "오프라인 · 로컬 저장됨",
        };
      case "error":
        return { dotClass: "bg-destructive", label: "동기화 실패" };
      default:
        return { dotClass: "bg-success", label: "자동 저장됨" };
    }
  })();

  return (
    <span
      data-testid="save-status"
      className="hidden items-center gap-1 text-2xs font-medium text-muted-foreground md:inline-flex"
    >
      <span className={cn("size-1.5 rounded-full", dotClass)}></span>
      {label}
    </span>
  );
}

function ShortcutTable({
  heading,
  rows,
}: {
  heading: string;
  rows: ReadonlyArray<{ keys: string; action: string }>;
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className="border-b pb-1 text-xs font-bold">{heading}</div>
      <table className="w-full">
        <tbody>
          {rows.map(({ keys, action }) => (
            <tr key={action}>
              <th
                scope="row"
                className="py-0.5 pr-3 text-left align-top font-normal whitespace-nowrap"
              >
                {keys.split(" / ").map((key, index) => (
                  <React.Fragment key={key}>
                    {index > 0 && " / "}
                    <Kbd>{key}</Kbd>
                  </React.Fragment>
                ))}
              </th>
              <td className="py-0.5 text-muted-foreground">{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 편집기 상단 네비게이션 헤더.
 */
export function EditorHeader({
  title,
  onUpdateTitle,
  onPresent,
  totalSongs,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onNewPresentation,
  onOpenLyricModal,
  onMakeCopy,
  onShare,
  sharedAccess,
  readOnly = false,
  backPath = "/presentations",
  className,
}: EditorHeaderProps): React.JSX.Element {
  const navigate = useNavigate();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(title);

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (tempTitle.trim() && tempTitle !== title) {
      onUpdateTitle(tempTitle.trim());
    } else {
      setTempTitle(title);
    }
  };

  return (
    <header
      data-testid="editor-header"
      className={cn(
        "flex h-14 items-center justify-between border-b bg-background px-4 select-none",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                data-testid="header-back-btn"
                className="text-muted-foreground"
                onClick={() => navigate(backPath)}
              />
            }
          >
            <ArrowLeftIcon />
            <span className="hidden sm:inline">홈</span>
          </TooltipTrigger>
          <TooltipContent>프레젠테이션 목록으로 돌아가기</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="header-file-menu-btn"
            render={<Button variant="ghost" size="sm" />}
          >
            파일
            <ChevronDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-testid="header-file-menu-dropdown"
            className="w-52"
          >
            {onNewPresentation && (
              <DropdownMenuItem onClick={onNewPresentation}>
                <PlusIcon />새 프레젠테이션
              </DropdownMenuItem>
            )}
            {onOpenLyricModal && (
              <DropdownMenuItem
                data-testid="header-file-menu-lyric-btn"
                onClick={onOpenLyricModal}
              >
                <FileTextIcon />새 가사 입력
              </DropdownMenuItem>
            )}
            {onMakeCopy && (
              <DropdownMenuItem
                data-testid="header-file-menu-copy-btn"
                onClick={onMakeCopy}
              >
                <CopyIcon />
                사본 만들기
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-4" />

        <div className="flex min-w-0 items-center gap-2">
          {readOnly ? (
            <span
              data-testid="header-title-text"
              className="max-w-xs truncate px-2 text-sm font-bold sm:max-w-md"
            >
              {title}
            </span>
          ) : isEditingTitle ? (
            <Input
              type="text"
              value={tempTitle}
              autoFocus
              aria-label="프레젠테이션 제목"
              onChange={(e) => setTempTitle(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTitleSubmit();
                if (e.key === "Escape") {
                  setIsEditingTitle(false);
                  setTempTitle(title);
                }
              }}
              className="h-7 w-64 font-semibold"
            />
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="header-title-btn"
                    className="max-w-xs text-sm font-bold sm:max-w-md"
                    onClick={() => {
                      setTempTitle(title);
                      setIsEditingTitle(true);
                    }}
                  />
                }
              >
                <span className="truncate">{title}</span>
                <PencilIcon className="text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>클릭하여 제목 수정</TooltipContent>
            </Tooltip>
          )}

          {sharedAccess && (
            <Badge
              data-testid="header-shared-badge"
              variant="secondary"
              className="hidden md:inline-flex"
            >
              <UsersIcon />
              {sharedAccess.ownerName}님이 공유 · 보기 전용
            </Badge>
          )}

          {!readOnly && <SaveStatusIndicator />}
        </div>

        {(onUndo || onRedo) && (
          <div className="hidden items-center gap-0.5 border-l pl-2 sm:flex">
            <IconButton
              label="실행 취소 (Ctrl/⌘+Z)"
              size="icon-sm"
              data-testid="header-undo-btn"
              disabled={!canUndo}
              onClick={onUndo}
            >
              <Undo2Icon />
            </IconButton>
            <IconButton
              label="다시 실행 (Ctrl/⌘+Shift+Z)"
              size="icon-sm"
              data-testid="header-redo-btn"
              disabled={!canRedo}
              onClick={onRedo}
            >
              <Redo2Icon />
            </IconButton>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Popover>
          <PopoverTrigger
            data-testid="header-shortcuts-btn"
            render={
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
              />
            }
          >
            <InfoIcon />
            <span className="hidden sm:inline">단축키</span>
          </PopoverTrigger>
          <PopoverContent
            data-testid="header-shortcuts-popover"
            align="end"
            className="max-h-(--available-height) w-96 overflow-y-auto text-xs"
          >
            <ShortcutTable heading="편집 단축키" rows={EDITOR_SHORTCUT_GUIDE} />
            <ShortcutTable
              heading="발표 송출 단축키"
              rows={PRESENTATION_SHORTCUT_GUIDE}
            />
            <div className="space-y-1 border-t pt-2">
              <div className="font-semibold">번호 이동 규칙</div>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {NUMBER_JUMP_RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          </PopoverContent>
        </Popover>

        <ThemeMenuButton variant="compact" align="end" />

        {onShare && (
          <Button
            data-testid="header-share-btn"
            variant="outline"
            onClick={onShare}
          >
            <Share2Icon />
            공유
          </Button>
        )}

        <Button
          data-testid="header-present-btn"
          disabled={totalSongs === 0}
          onClick={onPresent}
        >
          <PlayIcon className="fill-current" />
          슬라이드쇼 발표
        </Button>
      </div>
    </header>
  );
}
