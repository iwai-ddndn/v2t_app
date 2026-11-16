import { describe, expect, test } from 'vitest';
import { loadSettings, DEFAULT_SETTINGS } from '@/store/settings';
import { autoTitle, loadSessions, newSession, parseLegacyText, sessionUsd, useSessions } from '@/store/sessions';
import { fmtDuration, fmtRange, fmtYen } from '@/lib/format';

describe('設定の移行', () => {
  test('初回は既定値・セットアップ未完了', () => {
    const s = loadSettings(null);
    expect(s.onboarded).toBe(false);
    expect(s.openaiModel).toBe('gpt-transcribe');
  });
  test('旧版(v1)の設定はセットアップ済み扱いで、旧既定モデルを移行する', () => {
    const s = loadSettings(JSON.stringify({ engine: 'openai', openaiModel: 'gpt-4o-mini-transcribe', openaiKey: 'k', fontSize: 22 }));
    expect(s).toMatchObject({ onboarded: true, openaiModel: 'gpt-transcribe', fontSize: 22, inputSource: 'mic', normalize: true, settingsVersion: 3 });
  });
  test('v2 で自分で選んだモデルは変えない', () => {
    expect(loadSettings(JSON.stringify({ settingsVersion: 2, openaiModel: 'gpt-4o-mini-transcribe' })).openaiModel).toBe('gpt-4o-mini-transcribe');
  });
  test('壊れた JSON でも既定値で起動する', () => {
    expect(loadSettings('{oops').engine).toBe(DEFAULT_SETTINGS.engine);
  });
});

describe('記録', () => {
  test('旧版の書き出し形式を区間に戻す', () => {
    const segs = parseLegacyText('[00:05] 話者1: こんにちは\n[1:02:03] 長い会議\n時刻なし');
    expect(segs.map((s) => [s.t, s.text, s.speaker])).toEqual([[5, 'こんにちは', '1'], [3723, '長い会議', null], [0, '時刻なし', undefined]]);
  });
  test('旧版の現在の記録と履歴を引き継ぐ', () => {
    const store: Record<string, string> = {
      'v2t.current': JSON.stringify({ created: '2026-01-01T00:00:00Z', segments: [{ t: 10, text: 'a' }], usage: { x: { sec: 60, rate: 0.006 } } }),
      'v2t.history': JSON.stringify([{ id: 1, created: '2025-12-31T00:00:00Z', text: '[00:01] b' }]),
    };
    const { current, history } = loadSessions((k) => store[k] ?? null);
    expect(current.segments[0]).toMatchObject({ t: 10, text: 'a' });
    expect(current.durationSec).toBe(11);
    expect(sessionUsd(current)).toBeCloseTo(0.006);
    expect(history[0].segments[0]).toMatchObject({ t: 1, text: 'b' });
  });
  test('発言は時刻順に挿入され、印は 5 秒以内ならトグル', () => {
    useSessions.setState({ current: newSession(), history: [] });
    const st = useSessions.getState();
    st.addSegment({ t: 10, text: 'b' });
    st.addSegment({ t: 5, text: 'a' });
    expect(useSessions.getState().current.segments.map((s) => s.text)).toEqual(['a', 'b']);
    expect(st.toggleFlag(30)).toBe(true);
    expect(st.toggleFlag(33)).toBe(false);
    expect(useSessions.getState().current.flags).toEqual([]);
  });
  test('終了すると履歴に入り、空の記録は残さない', () => {
    useSessions.setState({ current: newSession(), history: [] });
    expect(useSessions.getState().endCurrent()).toBeNull();
    useSessions.getState().addSegment({ t: 1, text: '来週のリリースについて確認します。次に' });
    const ended = useSessions.getState().endCurrent();
    expect(ended?.title).toBe('来週のリリースについて確認します');
    expect(useSessions.getState().history).toHaveLength(1);
    expect(useSessions.getState().current.segments).toHaveLength(0);
  });
  test('自動タイトル', () => {
    expect(autoTitle({ ...newSession(), segments: [] })).toBe('会議');
  });
});

test('表示用の書式', () => {
  expect(fmtDuration(3725)).toBe('1時間2分');
  expect(fmtDuration(45)).toBe('45秒');
  expect(fmtRange(30)).toBe('30秒');
  expect(fmtRange(180)).toBe('3分');
  expect(fmtYen(0.001, 150)).toBe('¥1未満');
  expect(fmtYen(0.3, 150)).toBe('¥45');
});
