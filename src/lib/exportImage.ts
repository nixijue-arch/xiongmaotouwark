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
 * 复制 PNG 到剪贴板（chrome / edge 支持，safari 部分）
 */
export async function copyImageToClipboard(node: HTMLElement, opts?: ExportOptions): Promise<void> {
  const blob = await captureNode(node, opts);
  if (!navigator.clipboard || !('write' in navigator.clipboard)) {
    throw new Error('clipboard.write not supported');
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
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
