// html2canvas 包装 + clipboard / download helpers
// QuickMode 用，未来 Collection batch 也用

import html2canvas from 'html2canvas';

export interface ExportOptions {
  /** 输出像素 scale（1 = 1:1，2 = 高清） */
  scale?: number;
  /** PNG 文件名 (download 用) */
  filename?: string;
}

/**
 * 抓 DOM 节点为 PNG blob
 */
export async function captureNode(node: HTMLElement, opts: ExportOptions = {}): Promise<Blob> {
  const canvas = await html2canvas(node, {
    backgroundColor: null,
    scale: opts.scale ?? 2,
    logging: false,
    useCORS: true,
  });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });
}

/**
 * 复制 PNG 到剪贴板
 *
 * ⚠️ 关键: navigator.clipboard.write 必须在 user gesture 内同步调用
 * 不能先 await captureNode (~150-500ms async) 然后再 write
 * → 因为 await 期间 user gesture 失效 → "Document is not focused" 错误
 *
 * 修法: 把 blob 的 Promise 直接传给 ClipboardItem
 * → write() 在同步路径里立刻 fire (gesture 仍有效)
 * → 浏览器自己等 Promise resolve (gesture 期内允许)
 */
export async function copyImageToClipboard(node: HTMLElement, opts?: ExportOptions): Promise<void> {
  if (!navigator.clipboard || !('write' in navigator.clipboard)) {
    throw new Error('clipboard.write not supported');
  }
  // 不 await blob — 让 ClipboardItem 接管异步
  const blobPromise = captureNode(node, opts);
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blobPromise }),
  ]);
}

/**
 * 下载 PNG
 */
export async function downloadImage(node: HTMLElement, filename = 'panda-meme.png', opts?: ExportOptions): Promise<void> {
  const blob = await captureNode(node, opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
