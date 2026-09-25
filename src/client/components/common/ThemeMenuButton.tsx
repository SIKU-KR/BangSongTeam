import React from "react";
import {
  ChevronsUpDownIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "#components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";
import { useTheme, type ThemeMode } from "../../features/theme";

export interface ThemeMenuButtonProps {
  variant?: "full" | "compact";
  align?: "start" | "end";
}

interface ThemeOption {
  mode: ThemeMode;
  label: string;
  description: string;
  icon: LucideIcon;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    mode: "light",
    label: "라이트 모드",
    description: "밝은 화면 테마",
    icon: SunIcon,
  },
  {
    mode: "dark",
    label: "다크 모드",
    description: "어두운 화면 테마",
    icon: MoonIcon,
  },
  {
    mode: "system",
    label: "시스템 설정",
    description: "기기 설정에 맞춤",
    icon: MonitorIcon,
  },
];

function isThemeMode(value: unknown): value is ThemeMode {
  return THEME_OPTIONS.some((option) => option.mode === value);
}

/**
 * 테마 모드 전환 메뉴 버튼.
 * - `full`: 사이드바 아래의 넓은 버튼 (위로 연다)
 * - `compact`: 헤더의 아이콘 버튼 (아래로 연다)
 */
export function ThemeMenuButton({
  variant = "full",
  align = "start",
}: ThemeMenuButtonProps): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const current =
    THEME_OPTIONS.find((option) => option.mode === theme) ?? THEME_OPTIONS[2];
  const CurrentIcon = current.icon;

  const trigger =
    variant === "compact" ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              data-testid="theme-menu-button"
              aria-label={`테마 설정: ${current.label}`}
              render={<Button variant="ghost" size="icon" />}
            />
          }
        >
          <CurrentIcon />
        </TooltipTrigger>
        <TooltipContent>테마 설정: {current.label}</TooltipContent>
      </Tooltip>
    ) : (
      <DropdownMenuTrigger
        data-testid="theme-menu-button"
        render={
          <Button
            variant="outline"
            className="h-auto w-full justify-between rounded-xl px-3 py-2"
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
            <CurrentIcon className="size-3.5" />
          </span>
          <span className="min-w-0 text-left">
            <span className="block truncate text-xs font-semibold">
              {current.label}
            </span>
            <span className="block truncate text-2xs font-normal text-muted-foreground">
              화면 모드 전환
            </span>
          </span>
        </span>
        <ChevronsUpDownIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
    );

  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent
        data-testid="theme-menu-dropdown"
        side={variant === "compact" ? "bottom" : "top"}
        align={align}
        className="w-56"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>테마 설정</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => {
              if (isThemeMode(value)) setTheme(value);
            }}
          >
            {THEME_OPTIONS.map((option) => (
              <DropdownMenuRadioItem
                key={option.mode}
                value={option.mode}
                data-testid={`theme-option-${option.mode}`}
                closeOnClick
              >
                <option.icon />
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ThemeMenuButton;
