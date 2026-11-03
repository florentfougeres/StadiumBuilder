import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'stadiumforge.theme';
const systemQuery = () => window.matchMedia('(prefers-color-scheme: light)');

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** The chosen theme, or the system's while the user has not picked one. */
function resolveTheme(): Theme {
  return storedTheme() ?? (systemQuery().matches ? 'light' : 'dark');
}

/**
 * Current theme and a toggle. index.html applies the same resolution before
 * first paint; this keeps `data-theme` in sync afterwards, including system
 * changes while no explicit choice is stored.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(resolveTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const query = systemQuery();
    const follow = () => {
      if (!storedTheme()) setTheme(query.matches ? 'light' : 'dark');
    };
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Blocked storage: the choice lasts for this visit only.
    }
    setTheme(next);
  };

  return [theme, toggle];
}
