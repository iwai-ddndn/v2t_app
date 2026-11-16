import { create } from 'zustand';
import { DEFAULT_MODEL } from '@/lib/engines/openai';
import type { EngineId, EngineSettings } from '@/lib/engines/types';
import type { InputSource } from '@/lib/audio';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings extends EngineSettings {
  engine: EngineId;
  inputSource: InputSource;
  summaryModel: string;
  fontSize: number;
  ringMinutes: number;
  yenPerUsd: number;
  theme: Theme;
  catchupRange: number;
  onboarded: boolean;
  settingsVersion: number;
}

export const DEFAULT_SETTINGS: Settings = {
  engine: 'openai', lang: 'ja-JP',
  openaiKey: '', openaiModel: DEFAULT_MODEL, openaiBaseUrl: '', chunkMin: 8, chunkMax: 20, summaryModel: 'gpt-5-mini',
  sonioxKey: '', sonioxModel: 'stt-rt-v5', diarize: false,
  inputSource: 'mic', normalize: true, glossary: '',
  fontSize: 18, ringMinutes: 10, yenPerUsd: 150, theme: 'system', catchupRange: 60,
  onboarded: false, settingsVersion: 3,
};

const KEY = 'v2t.settings';

/** 旧版(v1/v2)の設定を引き継ぐ */
export function loadSettings(raw: string | null): Settings {
  let stored: Partial<Settings> & Record<string, unknown> = {};
  try { stored = raw ? JSON.parse(raw) : {}; } catch { stored = {}; }
  const s: Settings = { ...DEFAULT_SETTINGS, ...stored } as Settings;
  const version = Number(stored.settingsVersion || (Object.keys(stored).length ? 1 : 3));
  if (version < 2 && stored.openaiModel === 'gpt-4o-mini-transcribe') s.openaiModel = DEFAULT_MODEL;
  if (version < 3 && Object.keys(stored).length) {
    // 旧版を使っていた人はセットアップ済みとみなす(キーがあればなおさら)
    s.onboarded = true;
    if (!stored.inputSource) s.inputSource = 'mic';
    if (stored.normalize === undefined) s.normalize = true;
  }
  s.settingsVersion = 3;
  return s;
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
}

const storage = typeof localStorage !== 'undefined' ? localStorage : undefined;

export const useSettings = create<SettingsStore>((set, get) => ({
  ...loadSettings(storage?.getItem(KEY) ?? null),
  set: (patch) => {
    set(patch);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { set: _omit, ...rest } = get();
    storage?.setItem(KEY, JSON.stringify(rest));
  },
}));

// 旧版から移行した内容をすぐ保存する
if (storage) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { set: _omit, ...rest } = useSettings.getState();
  storage.setItem(KEY, JSON.stringify(rest));
}

export const getSettings = (): Settings => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { set: _omit, ...rest } = useSettings.getState();
  return rest;
};
