/** テキストを書き出す。共有シートが使えればそれを、だめならダウンロード */
export async function shareText(title: string, text: string): Promise<'shared' | 'downloaded'> {
  const file = new File([text], `${title}.txt`, { type: 'text/plain' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title }); return 'shared'; } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  downloadText(`${title}.txt`, text);
  return 'downloaded';
}

export function downloadText(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
