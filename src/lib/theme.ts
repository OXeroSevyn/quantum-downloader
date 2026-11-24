import { useEffect } from 'react';

/** Applies 'light' | 'dark' | 'system' to <body data-theme>, following the OS when 'system'. */
export function useTheme(theme: string | undefined): void {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'dark' || theme === 'light' ? theme : mq.matches ? 'dark' : 'light';
      document.body.dataset.theme = resolved;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}
