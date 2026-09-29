import { EDITOR_COPY } from "#copy/editor";

const NAMES = EDITOR_COPY.ribbon.palette.names;

export interface PaletteColor {
  /** `#RRGGBB` 대문자 */
  value: string;
  label: string;
}

/** 열마다의 명도 변형. 양수는 x% 더 밝게, 음수는 x% 더 어둡게 */
const ACCENT_SHADES: readonly number[] = [80, 60, 40, -25, -50];

const THEME_COLUMNS: ReadonlyArray<{
  name: string;
  value: string;
  shades: readonly number[];
}> = [
  { name: NAMES.white, value: "#FFFFFF", shades: [-5, -15, -25, -35, -50] },
  { name: NAMES.black, value: "#000000", shades: [50, 35, 25, 15, 5] },
  { name: NAMES.tan, value: "#E7E6E6", shades: [-10, -25, -50, -75, -90] },
  { name: NAMES.blueGray, value: "#44546A", shades: ACCENT_SHADES },
  { name: NAMES.blue, value: "#4472C4", shades: ACCENT_SHADES },
  { name: NAMES.orange, value: "#ED7D31", shades: ACCENT_SHADES },
  { name: NAMES.gray, value: "#A5A5A5", shades: ACCENT_SHADES },
  { name: NAMES.gold, value: "#FFC000", shades: ACCENT_SHADES },
  { name: NAMES.skyBlue, value: "#5B9BD5", shades: ACCENT_SHADES },
  { name: NAMES.green, value: "#70AD47", shades: ACCENT_SHADES },
];

function toHsl(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hueToChannel(p: number, q: number, t: number): number {
  const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
}

function toHex(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channels =
    s === 0
      ? [l, l, l]
      : [
          hueToChannel(p, q, h + 1 / 3),
          hueToChannel(p, q, h),
          hueToChannel(p, q, h - 1 / 3),
        ];
  return `#${channels
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

function shadeColor(hex: string, percent: number): string {
  const [h, s, l] = toHsl(hex);
  const x = Math.abs(percent) / 100;
  return toHex(h, s, percent > 0 ? l * (1 - x) + x : l * (1 - x));
}

/**
 * PowerPoint '테마 색' 격자 (Office 테마). 첫 행은 기본 10색, 나머지 5행은 열마다
 * 정해진 밝게·어둡게 변형이다.
 */
export const THEME_COLOR_ROWS: readonly PaletteColor[][] = [
  THEME_COLUMNS.map(({ name, value }) => ({ value, label: name })),
  ...[0, 1, 2, 3, 4].map((row) =>
    THEME_COLUMNS.map(({ name, value, shades }) => {
      const percent = shades[row] ?? 0;
      return {
        value: shadeColor(value, percent),
        label:
          percent > 0
            ? EDITOR_COPY.ribbon.palette.lighter(name, percent)
            : EDITOR_COPY.ribbon.palette.darker(name, -percent),
      };
    }),
  ),
];

/** PowerPoint '표준 색' 한 줄 */
export const STANDARD_COLORS: readonly PaletteColor[] = [
  { value: "#C00000", label: NAMES.darkRed },
  { value: "#FF0000", label: NAMES.red },
  { value: "#FFC000", label: NAMES.orange },
  { value: "#FFFF00", label: NAMES.yellow },
  { value: "#92D050", label: NAMES.lightGreen },
  { value: "#00B050", label: NAMES.green },
  { value: "#00B0F0", label: NAMES.lightBlue },
  { value: "#0070C0", label: NAMES.blue },
  { value: "#002060", label: NAMES.darkBlue },
  { value: "#7030A0", label: NAMES.purple },
];
