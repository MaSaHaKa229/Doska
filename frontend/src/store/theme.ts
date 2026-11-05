export type ThemePreference = 'light' | 'dark' | 'system';

const KEY = 'doska.theme';
let media: MediaQueryList | null = null;
let current: ThemePreference = 'system';

function resolve(pref: ThemePreference): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function onSystemChange() {
  if (current === 'system') document.documentElement.dataset.theme = resolve('system');
}

/** Применить тему (и запомнить локально, чтобы страница входа открывалась в той же теме). */
export function applyTheme(pref: ThemePreference): void {
  current = pref;
  document.documentElement.dataset.theme = resolve(pref);
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* приватный режим */
  }
  if (!media && window.matchMedia) {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener?.('change', onSystemChange);
  }
}

export function storedTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}
