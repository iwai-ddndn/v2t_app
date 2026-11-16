import { create } from 'zustand';
import { openInput, RingBuffer, Vad, type InputHandle } from '@/lib/audio';
import * as WebSpeech from '@/lib/engines/webspeech';
import * as OpenAI from '@/lib/engines/openai';
import * as Soniox from '@/lib/engines/soniox';
import type { Engine, EngineCallbacks, EngineId } from '@/lib/engines/types';
import { getSettings } from './settings';
import { useSessions } from './sessions';

export type RecState = 'idle' | 'starting' | 'recording' | 'stopping' | 'paused';

export interface Level { db: number; speech: boolean }

export type Notice =
  | { kind: 'quiet' }
  | { kind: 'share-ended' }
  | { kind: 'error'; message: string }
  | null;

interface RecorderStore {
  state: RecState;
  /** 録音開始時点の基準秒(一時停止をまたいで通算) */
  elapsed: number;
  interim: string;
  level: Level | null;
  notice: Notice;
  pending: number;
  engineName: string;
  liveUsd: number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  dismissNotice: () => void;
}

const ENGINES: Record<EngineId, (cb: EngineCallbacks) => Engine> = {
  webspeech: (cb) => WebSpeech.create(getSettings(), cb),
  openai: (cb) => OpenAI.create(getSettings(), cb),
  soniox: (cb) => Soniox.create(getSettings(), cb),
};

// 実行時の参照(React の状態にしないもの)
let engine: Engine | null = null;
let input: InputHandle | null = null;
let ring: RingBuffer | null = null;
let startedAt = 0;
let base = 0;
let tick: ReturnType<typeof setInterval> | undefined;
let wakeLock: { release(): Promise<void> } | null = null;

export const getRing = () => ring;
/** 現在の経過秒(store の elapsed は 1 秒ごとにしか更新されないため、正確な値はこちら) */
export const nowElapsed = () => base + (startedAt ? (performance.now() - startedAt) / 1000 : 0);

async function requestWake() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wakeLock = await (navigator as any).wakeLock?.request('screen');
  } catch { wakeLock = null; }
}

export const useRecorder = create<RecorderStore>((set, get) => ({
  state: 'idle',
  elapsed: useSessions.getState().current.durationSec,
  interim: '',
  level: null,
  notice: null,
  pending: 0,
  engineName: '',
  liveUsd: 0,
  dismissNotice: () => set({ notice: null }),

  async start() {
    if (get().state === 'recording' || get().state === 'starting') return;
    const settings = getSettings();
    base = useSessions.getState().current.durationSec;
    set({ state: 'starting', notice: null, interim: '' });
    const sessions = useSessions.getState;
    const cb: EngineCallbacks = {
      now: nowElapsed,
      offset: base,
      onSegment: (s) => sessions().addSegment(s),
      onInterim: (t) => {
        const m = t.match(/^…文字起こし中\((\d+)件\)$/);
        if (m) set({ pending: Number(m[1]), interim: '' });
        else set({ interim: t, pending: t ? get().pending : 0 });
      },
      onStatus: (t) => {
        if (/失敗|エラー|切断|正しくありません/.test(t)) set({ notice: { kind: 'error', message: t } });
      },
      onError: (e) => set({ notice: { kind: 'error', message: e.message } }),
      onUsage: (sec) => {
        if (engine) sessions().addUsage(engine.info.name, { sec, rate: engine.info.costPerMin });
      },
    };
    try {
      engine = ENGINES[settings.engine](cb);
      if (engine.info.needsMic) {
        ring = ring && sessions().current.durationSec > 0 ? ring : new RingBuffer(settings.ringMinutes * 60);
        const meter = new Vad();
        let quiet = 0;
        const r = ring;
        const eng = engine;
        input = await openInput((pcm) => {
          r.push(pcm);
          eng.feed(pcm);
          const v = meter.push(pcm);
          set({ level: { db: v.levelDb, speech: v.speech } });
          // 5 秒以上ほぼ無音なら案内を出す(1 回だけ)
          quiet = v.levelDb < -55 ? quiet + 1 : 0;
          if (quiet === 50 && !get().notice) set({ notice: { kind: 'quiet' } });
        }, {
          source: settings.inputSource,
          onEnded: () => { if (get().state === 'recording') set({ notice: { kind: 'share-ended' } }); },
        });
      }
      await engine.start();
    } catch (e) {
      if (input) { await input.close(); input = null; }
      engine = null;
      set({ state: base > 0 ? 'paused' : 'idle', notice: { kind: 'error', message: (e as Error).message } });
      return;
    }
    startedAt = performance.now();
    set({ state: 'recording', engineName: engine.info.name });
    requestWake();
    const rate = engine.info.costPerMin;
    tick = setInterval(() => {
      const e = nowElapsed();
      set({ elapsed: e, liveUsd: ((e - base) / 60) * rate });
    }, 1000);
  },

  async stop() {
    if (get().state !== 'recording' || !engine) return;
    set({ state: 'stopping' });
    clearInterval(tick);
    const total = nowElapsed();
    startedAt = 0; base = total;
    useSessions.getState().setDuration(total);
    if (input) { await input.close(); input = null; }
    await engine.stop().catch(() => {});
    engine = null;
    try { await wakeLock?.release(); } catch { /* 無視 */ }
    wakeLock = null;
    set({ state: 'paused', elapsed: total, interim: '', level: null, pending: 0, liveUsd: 0 });
  },
}));

/** 記録を終了して履歴へ。新しい記録を始める */
export function endSession() {
  const ended = useSessions.getState().endCurrent();
  ring = null; base = 0;
  useRecorder.setState({ state: 'idle', elapsed: 0, notice: null });
  return ended;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (useRecorder.getState().state !== 'recording') return;
    if (document.visibilityState === 'visible') requestWake();
  });
}
