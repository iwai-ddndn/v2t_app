import { useSyncExternalStore } from 'react';

// ハッシュ方式の簡易ルーター(暗号化した 1 枚の HTML でも動くように)
const subscribe = (cb: () => void) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };
const getPath = () => (window.location.hash.replace(/^#/, '') || '/');

export function useRoute(): string {
  return useSyncExternalStore(subscribe, getPath, () => '/');
}
export function navigate(path: string) {
  if (getPath() !== path) window.location.hash = path;
}
export function back(fallback = '/') {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}
