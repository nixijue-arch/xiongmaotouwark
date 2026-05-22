// 草稿缩略图工具: 把任意图 (含合成 dataURL / 导入 GIF 首帧) 缩成小尺寸不透明 webp。
// 草稿列表只显示 ~60px 缩略图, 但之前直接存 clip.src 全分辨率 dataURL (单图可达 ~100KB),
// ×N 草稿撑爆 IDB。这里缩到 96px webp (~2-4KB), 不影响项目数据 (仅 thumbSrc 显示用)。
export async function makeDraftThumb(src: string, size = 96): Promise<string | undefined> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('thumb img load failed'));
      i.src = src;
    });
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const iw = img.naturalWidth || size, ih = img.naturalHeight || size;
    const r = Math.min(size / iw, size / ih);              // contain (整图居中, 不裁)
    const w = iw * r, h = ih * r;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    const out = c.toDataURL('image/webp', 0.82);
    return out.startsWith('data:image/webp') ? out : c.toDataURL('image/jpeg', 0.8);  // Safari ≤14 fallback
  } catch {
    return undefined;
  }
}
