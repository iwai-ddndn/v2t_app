import { useEffect } from 'react';
import { useSettings } from '@/store/settings';

export function useApplyTheme() {
  const theme = useSettings((s) => s.theme);
  const fontSize = useSettings((s) => s.fontSize);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelectorAll('meta[name=theme-color]').forEach((m) => m.setAttribute('content', dark ? '#141218' : '#fef7ff'));
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.style.setProperty('--transcript-size', `${fontSize}px`);
  }, [fontSize]);
}
