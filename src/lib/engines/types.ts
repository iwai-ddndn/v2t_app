export interface RawSegment { t: number; text: string; speaker?: string | number | null }

export interface EngineCallbacks {
  /** 録音開始からの経過秒(セッション全体) */
  now(): number;
  /** このエンジンを開始した時点の経過秒 */
  offset: number;
  onSegment(s: RawSegment): void;
  onInterim(text: string): void;
  onStatus(text: string): void;
  onError(e: Error): void;
  onUsage(sec: number): void;
}

export interface EngineInfo { id: EngineId; name: string; costPerMin: number; needsMic: boolean }

export interface Engine {
  info: EngineInfo;
  start(): Promise<void>;
  feed(pcm: Int16Array): void;
  stop(): Promise<void>;
}

export type EngineId = 'webspeech' | 'openai' | 'soniox';

/** エンジンが読む設定 */
export interface EngineSettings {
  lang: string;
  openaiKey: string;
  openaiModel: string;
  openaiBaseUrl: string;
  chunkMin: number;
  chunkMax: number;
  sonioxKey: string;
  sonioxModel: string;
  diarize: boolean;
  glossary: string;
  normalize: boolean;
}
