import React, { useEffect, useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeMode) => void;
}

const THEME_STORAGE_KEY = "worship-theme";

export function getSystemTheme(): "light" | "dark" {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch (error) {
    void error;
  }
  return "system";
}

let currentTheme: ThemeMode = getStoredTheme();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function applyThemeToDOM(resolved: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.add("light");
    root.classList.remove("dark");
  }
  root.style.colorScheme = resolved;
}

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemThemeChange = () => {
    if (currentTheme === "system") {
      applyThemeToDOM(getSystemTheme());
      notifyListeners();
    }
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handleSystemThemeChange);
  } else if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(handleSystemThemeChange);
  }
}

export function setTheme(newTheme: ThemeMode): void {
  currentTheme = newTheme;
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    }
  } catch (error) {
    void error;
  }
  const resolved = newTheme === "system" ? getSystemTheme() : newTheme;
  applyThemeToDOM(resolved);
  notifyListeners();
}

export function getTheme(): ThemeMode {
  return currentTheme;
}

export function getResolvedTheme(): "light" | "dark" {
  return currentTheme === "system" ? getSystemTheme() : currentTheme;
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetThemeForTesting(themeOverride?: ThemeMode): void {
  currentTheme = themeOverride ?? getStoredTheme();
  const resolved = currentTheme === "system" ? getSystemTheme() : currentTheme;
  applyThemeToDOM(resolved);
  notifyListeners();
}

export interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: ThemeMode;
}

export function ThemeProvider({
  children,
  defaultTheme,
}: ThemeProviderProps): React.JSX.Element {
  useEffect(() => {
    if (defaultTheme) {
      setTheme(defaultTheme);
    } else {
      const stored = getStoredTheme();
      if (stored !== currentTheme) {
        setTheme(stored);
      } else {
        applyThemeToDOM(getResolvedTheme());
      }
    }
  }, [defaultTheme]);

  return <>{children}</>;
}

export function useTheme(): ThemeContextValue {
  const theme = useSyncExternalStore<ThemeMode>(
    subscribeTheme,
    getTheme,
    () => "system",
  );
  const resolvedTheme = useSyncExternalStore<"light" | "dark">(
    subscribeTheme,
    getResolvedTheme,
    () => "dark",
  );

  useEffect(() => {
    applyThemeToDOM(resolvedTheme);
  }, [resolvedTheme]);

  return {
    theme,
    resolvedTheme,
    setTheme,
  };
}
