import { create } from 'zustand';

export interface Segment { id: string; t: number; text: string; speaker?: string | number | null }
export interface Usage { sec: number; rate: number; usd?: number }
export interface Session {
  id: string;
  createdAt: string;
  title: string;
  segments: Segment[];
  /** 「印」をつけた時刻(秒) */
  flags: number[];
  usage: Record<string, Usage>;
  /** これまでの録音時間(秒) */
  durationSec: number;
}

const KEY = 'v2t.sessions.v3';

export const newSession = (): Session => ({
  id: `s${Date.now().toString(36)}`, createdAt: new Date().toISOString(), title: '',
  segments: [], flags: [], usage: {}, durationSec: 0,
});

export const sessionUsd = (s: Session) =>
  Object.values(s.usage).reduce((a, u) => a + (u.sec / 60) * u.rate + (u.usd || 0), 0);

export const segId = () => Math.random().toString(36).slice(2, 10);

/** 旧版の「[mm:ss] 話者1: 本文」形式のテキストを区間に戻す */
export function parseLegacyText(text: string): Segment[] {
  return text.split('\n').filter(Boolean).map((line) => {
    const m = line.match(/^\[(?:(\d+):)?(\d+):(\d+)\]\s*(?:話者(\S+?):\s*)?(.*)$/);
    if (!m) return { id: segId(), t: 0, text: line };
    const t = (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
    return { id: segId(), t, text: m[5], speaker: m[4] ?? null };
  });
}

interface Persisted { current: Session; history: Session[] }

export function loadSessions(get: (k: string) => string | null): Persisted {
  try {
    const v3 = get(KEY);
    if (v3) return JSON.parse(v3);
  } catch { /* 壊れていたら作り直す */ }
  // 旧版からの移行
  const current = newSession();
  try {
    const old = JSON.parse(get('v2t.current') || 'null');
    if (old?.segments?.length) {
      current.segments = old.segments.map((s: Segment) => ({ ...s, id: s.id || segId() }));
      current.createdAt = old.created || current.createdAt;
      current.usage = old.usage || {};
      current.durationSec = (old.segments.at(-1)?.t ?? 0) + 1;
    }
  } catch { /* 無視 */ }
  let history: Session[] = [];
  try {
    const oldHist = JSON.parse(get('v2t.history') || '[]') as { id: number; created: string; text: string }[];
    history = oldHist.map((h) => {
      const segs = parseLegacyText(h.text);
      return { ...newSession(), id: `s${h.id}`, createdAt: h.created, segments: segs, durationSec: (segs.at(-1)?.t ?? 0) + 1 };
    });
  } catch { /* 無視 */ }
  return { current, history };
}

interface SessionStore extends Persisted {
  addSegment: (s: Omit<Segment, 'id'>) => void;
  toggleFlag: (t: number) => boolean;
  addUsage: (name: string, u: Partial<Usage> & { rate?: number }) => void;
  setDuration: (sec: number) => void;
  endCurrent: () => Session | null;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;
  restore: (s: Session) => void;
}

const storage = typeof localStorage !== 'undefined' ? localStorage : undefined;

export const useSessions = create<SessionStore>((set, get) => {
  const save = () => {
    const { current, history } = get();
    storage?.setItem(KEY, JSON.stringify({ current, history }));
  };
  const update = (fn: (s: SessionStore) => Partial<SessionStore>) => { set(fn(get())); save(); };
  return {
    ...loadSessions((k) => storage?.getItem(k) ?? null),
    addSegment: (seg) => update(({ current }) => {
      const segs = current.segments.slice();
      let i = segs.length; while (i > 0 && segs[i - 1].t > seg.t) i--; // 時刻順に挿入
      segs.splice(i, 0, { ...seg, id: segId() });
      return { current: { ...current, segments: segs } };
    }),
    toggleFlag: (t) => {
      const { current } = get();
      const near = current.flags.findIndex((f) => Math.abs(f - t) < 5);
      const flags = near >= 0 ? current.flags.filter((_, i) => i !== near) : [...current.flags, t].sort((a, b) => a - b);
      update(() => ({ current: { ...current, flags } }));
      return near < 0;
    },
    addUsage: (name, u) => update(({ current }) => {
      const prev = current.usage[name] || { sec: 0, rate: u.rate ?? 0, usd: 0 };
      return { current: { ...current, usage: { ...current.usage, [name]: { sec: prev.sec + (u.sec || 0), rate: u.rate ?? prev.rate, usd: (prev.usd || 0) + (u.usd || 0) } } } };
    }),
    setDuration: (sec) => update(({ current }) => ({ current: { ...current, durationSec: sec } })),
    endCurrent: () => {
      const { current, history } = get();
      if (!current.segments.length) { update(() => ({ current: newSession() })); return null; }
      const ended = { ...current, title: current.title || autoTitle(current) };
      update(() => ({ current: newSession(), history: [ended, ...history].slice(0, 100) }));
      return ended;
    },
    rename: (id, title) => update(({ current, history }) => current.id === id
      ? { current: { ...current, title } }
      : { history: history.map((h) => (h.id === id ? { ...h, title } : h)) }),
    remove: (id) => update(({ history }) => ({ history: history.filter((h) => h.id !== id) })),
    restore: (s) => update(({ history }) => ({ history: [s, ...history.filter((h) => h.id !== s.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })),
  };
});

/** 最初の発言の冒頭をタイトルにする */
export function autoTitle(s: Session): string {
  const first = s.segments.find((x) => x.text.length > 4)?.text || s.segments[0]?.text || '会議';
  return first.replace(/[。！？!?].*$/, '').slice(0, 24) || '会議';
}
