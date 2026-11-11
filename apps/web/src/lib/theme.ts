const KEY = 'chappie.theme';

export type ThemeMode = 'light' | 'dark';

export function currentTheme(): ThemeMode {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  localStorage.setItem(KEY, mode);
}

export function initTheme(): void {
  const saved = localStorage.getItem(KEY);
  const dark =
    saved === 'dark' ||
    (saved === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function toggleTheme(): ThemeMode {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
