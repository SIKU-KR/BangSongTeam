import React, { useEffect, useState } from "react";
import { useNavigate } from "#hooks/useNavigate";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudAlertIcon,
  CopyIcon,
  FileTextIcon,
  HardDriveIcon,
  InfoIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Redo2Icon,
  RefreshCwIcon,
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
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "#components/ui/popover";
import { Separator } from "#components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";
import { IconButton } from "#components/common/IconButton";
import { copyToClipboard } from "../../lib/browser/clipboard";
import { usePersistenceError } from "../../lib/storage";
import {
  retrySyncNow,
  useSyncStatus,
  type SyncFailure,
  type SyncStatus,
} from "../../lib/sync";
import { ThemeMenuButton } from "../../components/common/ThemeMenuButton";
import {
  MAX_PRESENTATION_TITLE_LENGTH,
  type PresentationAccess,
} from "#shared";
import type { ProjectionMediaFailure } from "../offline/useProjectionMediaReady";
import { EDITOR_COPY, SHORTCUT_GUIDE } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";
import { BACKGROUND_COPY } from "#copy/backgrounds";

interface EditorHeaderProps {
  title: string;
  onUpdateTitle: (newTitle: string) => void;
  onPresent: () => void;
  totalSongs: number;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onNewPresentation?: () => void;
  onOpenLyricModal?: () => void;
  /** 공유받은 세트에만 넘긴다. 파일 메뉴에 '사본 만들기'를 더한다 */
  onMakeCopy?: () => void;
  /** 소유자에게만 넘긴다. 없으면 공유 버튼을 그리지 않는다 */
  onShare?: () => void;
  /** 공유받은 세트면 누가 어떤 권한으로 공유했는지 보여 준다 */
  sharedAccess?: PresentationAccess;
  /** 보기 권한 세트. 제목을 고칠 수 없다 */
  readOnly: boolean;
  /** `null`이면 돌아갈 드라이브가 없는 것이다 (로그인하지 않고 링크로 봄) */
  backPath: string | null;
  /**
   * 세트 배경 영상 중 이 기기에 저장된 수. 모두 저장됐으면 `null`이다.
   * 받다 실패해 곧 다시 받을 예정이면(`retrying`) '저장 중'과 구분해 보여 준다.
   * 저장 공간 부족이나 다시 받기를 멈춘 실패(`failure`)면 진행 대신 그 사실과 다시
   * 받기(`retry`)를 보여 준다
   */
  mediaProgress: {
    readyCount: number;
    totalCount: number;
    failure: ProjectionMediaFailure | null;
    retrying: boolean;
    retry: () => void;
  } | null;
}

interface SaveStatusIndicatorState {
  dotClass: string;
  label: string;
}

const SAVE_FAILED_INDICATOR: SaveStatusIndicatorState = {
  dotClass: "bg-destructive",
  label: EDITOR_COPY.syncStatus.saveFailed,
};

const SYNC_STATUS_INDICATOR: Record<SyncStatus, SaveStatusIndicatorState> = {
  idle: { dotClass: "bg-success", label: EDITOR_COPY.syncStatus.autoSaved },
  syncing: { dotClass: "bg-warning", label: EDITOR_COPY.syncStatus.syncing },
  synced: { dotClass: "bg-success", label: EDITOR_COPY.syncStatus.synced },
  offline: {
    dotClass: "bg-muted-foreground",
    label: EDITOR_COPY.syncStatus.offline,
  },
  error: {
    dotClass: "bg-destructive",
    label: EDITOR_COPY.syncStatus.syncFailed,
  },
};

const SYNC_TIME_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  hour: "numeric",
  minute: "2-digit",
});

const SYNC_DATE_TIME_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatSyncedAt(syncedAt: number): string {
  const synced = new Date(syncedAt);
  const isToday = synced.toDateString() === new Date().toDateString();
  return (isToday ? SYNC_TIME_FORMAT : SYNC_DATE_TIME_FORMAT).format(synced);
}

const FAILURE_CODE_LENGTH = 8;

const COPIED_FEEDBACK_MS = 2000;

const RETRYABLE_SYNC_STATUSES: ReadonlySet<SyncStatus> = new Set([
  "offline",
  "error",
]);

function CopyFailureCodeButton({ code }: { code: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <IconButton
      label={
        copied
          ? EDITOR_COPY.syncStatus.failureCodeCopied
          : EDITOR_COPY.syncStatus.copyFailureCode
      }
      size="icon-xs"
      data-testid="save-status-copy-code"
      onClick={() => {
        copyToClipboard(code).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  );
}

function SyncFailureDetail({
  failure,
  failureCode,
  lastSyncedLine,
  trigger,
  children,
}: {
  failure: SyncFailure | null;
  failureCode: string | null;
  lastSyncedLine: string;
  trigger: React.ReactElement;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger openOnHover render={trigger}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        data-testid="save-status-detail"
        align="start"
        className="gap-1.5 text-xs"
      >
        {failure && (failure.title || failure.reason) && (
          <PopoverHeader data-testid="save-status-failure">
            {failure.title && (
              <PopoverTitle>
                {EDITOR_COPY.syncStatus.failedItem(failure.title)}
              </PopoverTitle>
            )}
            {failure.reason && (
              <PopoverDescription>{failure.reason}</PopoverDescription>
            )}
          </PopoverHeader>
        )}
        <p className="text-muted-foreground">{lastSyncedLine}</p>
        {failureCode && (
          <div className="flex items-center gap-1">
            <span
              data-testid="save-status-failure-code"
              className="select-text"
            >
              {EDITOR_COPY.syncStatus.failureCode(failureCode)}
            </span>
            <CopyFailureCodeButton code={failureCode} />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SaveStatusIndicator(): React.JSX.Element {
  const persistenceError = usePersistenceError("presentation");
  const { status, lastSyncedAt, lastFailure, failureRequestId } =
    useSyncStatus();

  const { dotClass, label } = persistenceError
    ? SAVE_FAILED_INDICATOR
    : SYNC_STATUS_INDICATOR[status];
  const canRetry = RETRYABLE_SYNC_STATUSES.has(status);
  const syncFailed = status === "error";
  const lastSyncedLine =
    lastSyncedAt === null
      ? EDITOR_COPY.syncStatus.notSyncedYet
      : EDITOR_COPY.syncStatus.lastSynced(formatSyncedAt(lastSyncedAt));

  const trigger = (
    <Button
      variant="ghost"
      size="xs"
      data-testid="save-status"
      className="min-w-0 shrink"
    />
  );
  const statusLabel = (
    <>
      <span className={cn("size-1.5 shrink-0 rounded-full", dotClass)}></span>
      <span className="truncate text-muted-foreground">{label}</span>
    </>
  );

  return (
    <span
      data-testid="save-status-bar"
      className={cn(
        "min-w-0 items-center gap-1",
        syncFailed ? "inline-flex" : "hidden md:inline-flex",
      )}
    >
      {syncFailed ? (
        <SyncFailureDetail
          failure={lastFailure}
          failureCode={
            failureRequestId
              ? failureRequestId.slice(0, FAILURE_CODE_LENGTH)
              : null
          }
          lastSyncedLine={lastSyncedLine}
          trigger={trigger}
        >
          {statusLabel}
        </SyncFailureDetail>
      ) : (
        <Tooltip>
          <TooltipTrigger render={trigger}>{statusLabel}</TooltipTrigger>
          <TooltipContent
            data-testid="save-status-detail"
            className="flex-col items-start"
          >
            <span>{lastSyncedLine}</span>
          </TooltipContent>
        </Tooltip>
      )}
      {canRetry && (
        <IconButton
          label={COMMON_COPY.retry}
          variant="outline"
          size="icon-xs"
          data-testid="save-status-retry"
          onClick={retrySyncNow}
        >
          <RefreshCwIcon />
        </IconButton>
      )}
    </span>
  );
}

function PresentationTitleField({
  title,
  readOnly,
  onSubmit,
}: {
  title: string;
  readOnly: boolean;
  onSubmit: (newTitle: string) => void;
}): React.JSX.Element {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(title);

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (tempTitle.trim() && tempTitle !== title) {
      onSubmit(tempTitle.trim());
    } else {
      setTempTitle(title);
    }
  };

  if (readOnly) {
    return (
      <span
        data-testid="header-title-text"
        className="max-w-xs truncate px-2 text-sm font-bold sm:max-w-md"
      >
        {title}
      </span>
    );
  }

  if (isEditingTitle) {
    return (
      <Input
        type="text"
        value={tempTitle}
        maxLength={MAX_PRESENTATION_TITLE_LENGTH}
        autoFocus
        aria-label={EDITOR_COPY.header.titleLabel}
        onChange={(e) => setTempTitle(e.target.value)}
        onBlur={handleTitleSubmit}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            // 리스너 하나가 끝날 때마다 마이크로태스크가 돌아 React가 입력칸을 지운 뒤 window의
            // 단축키 처리기가 이 키를 포커스 없는 Enter로 읽는다.
            // https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-script
            e.stopPropagation();
            handleTitleSubmit();
          }
          if (e.key === "Escape") {
            setIsEditingTitle(false);
            setTempTitle(title);
          }
        }}
        className="h-7 w-64 font-semibold"
      />
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            data-testid="header-title-btn"
            className="max-w-xs min-w-0 shrink text-sm font-bold sm:max-w-md"
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
      <TooltipContent>{EDITOR_COPY.header.editTitle}</TooltipContent>
    </Tooltip>
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

function MediaFailurePopover({
  failure,
  onRetry,
}: {
  failure: ProjectionMediaFailure;
  onRetry: () => void;
}): React.JSX.Element {
  const quota = failure === "quota";
  return (
    <Popover>
      <PopoverTrigger
        data-testid="header-media-failure"
        data-failure={failure}
        render={<Button variant="destructive" size="sm" />}
      >
        {quota ? <HardDriveIcon /> : <CloudAlertIcon />}
        {quota
          ? BACKGROUND_COPY.prepare.editorQuota
          : BACKGROUND_COPY.prepare.editorFailed}
      </PopoverTrigger>
      <PopoverContent data-testid="header-media-failure-popover" align="end">
        <PopoverDescription>
          {BACKGROUND_COPY.prepare.failed[failure]}
        </PopoverDescription>
        <Button
          data-testid="header-media-failure-retry"
          size="sm"
          onClick={onRetry}
        >
          {BACKGROUND_COPY.prepare.retry}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function ShortcutGuidePopover(): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger
        data-testid="header-shortcuts-btn"
        render={
          <Button variant="ghost" size="sm" className="text-muted-foreground" />
        }
      >
        <InfoIcon />
        <span className="hidden sm:inline">{EDITOR_COPY.header.shortcuts}</span>
      </PopoverTrigger>
      <PopoverContent
        data-testid="header-shortcuts-popover"
        align="end"
        className="max-h-(--available-height) w-96 overflow-y-auto text-xs"
      >
        <ShortcutTable
          heading={EDITOR_COPY.header.editorShortcuts}
          rows={SHORTCUT_GUIDE.editor}
        />
        <ShortcutTable
          heading={EDITOR_COPY.header.presentShortcuts}
          rows={SHORTCUT_GUIDE.presentation}
        />
        <div className="space-y-1 border-t pt-2">
          <div className="font-semibold">
            {EDITOR_COPY.header.numberJumpRules}
          </div>
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            {EDITOR_COPY.numberJumpRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 편집기 상단 네비게이션 헤더.
 *
 * 동기화 실패면 저장 상태를 눌러(마우스는 올려도) 연 창에 실패한 항목의 제목과 이유, 실패한
 * 요청의 상관 ID 앞 8자리를 문의 코드로 보여 준다. 앞부분만으로도 Worker 로그에서 앞부분 일치로
 * 찾을 수 있고, 사용자가 읽어 주기 쉽다. 툴팁은 마우스로만 열리고 고를 수도 없어, 실패 내용은
 * 터치로도 열리는 팝오버에 두고 문의 코드는 고르거나 복사할 수 있게 한다. 저장 상태는 좁은
 * 화면에서 숨기지만, 동기화 실패는 좁은 화면에서도 보인다. 오류 원문(`SyncFailure.message`)은
 * 개발자용 글일 수 있어 그리지 않는다.
 *
 * '저장 실패'는 프레젠테이션을 이 기기에 저장하지 못할 때만 보인다. 곡 보관함·폴더의 저장 실패는
 * 경고 배너가 알리고, 헤더는 동기화 상태를 그대로 보인다. 기기에 저장하지 못하는 동안에도 다시
 * 시도와 문의 코드는 동기화 상태를 따른다. 그때는 서버 사본이 유일하게 안전한 사본이다.
 */
export function EditorHeader({
  title,
  onUpdateTitle,
  onPresent,
  totalSongs,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onNewPresentation,
  onOpenLyricModal,
  onMakeCopy,
  onShare,
  sharedAccess,
  readOnly,
  backPath,
  mediaProgress,
}: EditorHeaderProps): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <header
      data-testid="editor-header"
      className="flex h-14 items-center justify-between border-b bg-background px-4 select-none"
    >
      <div className="flex min-w-0 items-center gap-3">
        {backPath !== null && (
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
              <span className="hidden sm:inline">
                {EDITOR_COPY.header.home}
              </span>
            </TooltipTrigger>
            <TooltipContent>{EDITOR_COPY.header.backToList}</TooltipContent>
          </Tooltip>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="header-file-menu-btn"
            render={<Button variant="ghost" size="sm" />}
          >
            {EDITOR_COPY.header.file}
            <ChevronDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-testid="header-file-menu-dropdown"
            className="w-52"
          >
            {onNewPresentation && (
              <DropdownMenuItem onClick={onNewPresentation}>
                <PlusIcon />
                {COMMON_COPY.newPresentation}
              </DropdownMenuItem>
            )}
            {onOpenLyricModal && (
              <DropdownMenuItem
                data-testid="header-file-menu-lyric-btn"
                onClick={onOpenLyricModal}
              >
                <FileTextIcon />
                {EDITOR_COPY.song.newLyrics}
              </DropdownMenuItem>
            )}
            {onMakeCopy && (
              <DropdownMenuItem
                data-testid="header-file-menu-copy-btn"
                onClick={onMakeCopy}
              >
                <CopyIcon />
                {COMMON_COPY.makeCopy}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-4" />

        <div className="flex min-w-0 items-center gap-2">
          <PresentationTitleField
            title={title}
            readOnly={readOnly}
            onSubmit={onUpdateTitle}
          />

          {sharedAccess && (
            <Badge
              data-testid="header-shared-badge"
              variant="secondary"
              className="hidden md:inline-flex"
            >
              <UsersIcon />
              {EDITOR_COPY.header.sharedBy(sharedAccess.ownerName)}
            </Badge>
          )}

          {!readOnly && <SaveStatusIndicator />}
        </div>

        {(onUndo || onRedo) && (
          <div className="hidden items-center gap-0.5 border-l pl-2 sm:flex">
            <IconButton
              label={EDITOR_COPY.header.undo}
              size="icon-sm"
              data-testid="header-undo-btn"
              disabled={!canUndo}
              onClick={onUndo}
            >
              <Undo2Icon />
            </IconButton>
            <IconButton
              label={EDITOR_COPY.header.redo}
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
        <ShortcutGuidePopover />

        <ThemeMenuButton />

        {onShare && (
          <Button
            data-testid="header-share-btn"
            variant="outline"
            onClick={onShare}
          >
            <Share2Icon />
            {COMMON_COPY.share}
          </Button>
        )}

        {mediaProgress?.failure ? (
          <MediaFailurePopover
            failure={mediaProgress.failure}
            onRetry={mediaProgress.retry}
          />
        ) : (
          mediaProgress && (
            <Badge
              variant={mediaProgress.retrying ? "outline" : "secondary"}
              data-testid="header-media-progress"
              data-state={mediaProgress.retrying ? "retrying" : "downloading"}
            >
              {(mediaProgress.retrying
                ? BACKGROUND_COPY.prepare.editorRetrying
                : BACKGROUND_COPY.prepare.editorStatus)(
                mediaProgress.readyCount,
                mediaProgress.totalCount,
              )}
            </Badge>
          )
        )}

        <Button
          data-testid="header-present-btn"
          disabled={totalSongs === 0}
          onClick={onPresent}
        >
          <PlayIcon className="fill-current" />
          {EDITOR_COPY.slide.present}
        </Button>
      </div>
    </header>
  );
}
