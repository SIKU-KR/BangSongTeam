import React from "react";
import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
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
import { useTheme } from "#components/theme-provider";

interface ThemeOption {
  mode: ReturnType<typeof useTheme>["theme"];
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

function isThemeMode(value: unknown): value is ThemeOption["mode"] {
  return THEME_OPTIONS.some((option) => option.mode === value);
}

/** 헤더의 테마 모드 전환 아이콘 버튼 (편집기·홈 공통) */
export function ThemeMenuButton(): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const current =
    THEME_OPTIONS.find((option) => option.mode === theme) ?? THEME_OPTIONS[2];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
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
      <DropdownMenuContent
        data-testid="theme-menu-dropdown"
        side="bottom"
        align="end"
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
