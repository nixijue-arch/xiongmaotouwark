// 实测调研: AI 生成熊猫 (vs 真黑白梗图) 的可分离 metric
// 用法: bun run scripts/test-ai-panda.mjs <query>
// 输出: 每张图 (size, white-bg ratio, avgSat, colorful, binary, gray std)

import sharp from 'sharp';

const PORT = 8123;
const query = process.argv[2] || '打工';

async function fetchImage(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    const raw = await sharp(buf).resize(60, 60, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    return { raw, w: meta.width ?? 0, h: meta.height ?? 0, size: contentLength || buf.length };
  } catch (e) {
    return null;
  }
}

function analyze(rgba) {
  const total = 60 * 60;
  let colorful = 0, binary = 0, whiteBg = 0, blackPx = 0;
  let totalSat = 0;
  const grays = [];
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const gray = (r + g + b) / 3;
    const sat = max - min;
    totalSat += sat;
    grays.push(gray);
    if (max > 30 && sat > 40) colorful++;
    if (gray > 240 || gray < 30) binary++;
    if (gray > 240) whiteBg++;
    if (gray < 30) blackPx++;
  }
  // gray standard deviation
  const meanGray = grays.reduce((a, b) => a + b, 0) / total;
  const variance = grays.reduce((acc, g) => acc + (g - meanGray) ** 2, 0) / total;
  const std = Math.sqrt(variance);
  return {
    colorfulRatio: colorful / total,
    binaryRatio: binary / total,
    whiteBgRatio: whiteBg / total,
    blackRatio: blackPx / total,
    avgSat: totalSat / total,
    grayStd: std,
    meanGray,
  };
}

async function main() {
  console.log(`[test-ai-panda] query="${query}"\n`);
  const sr = await fetch(`http://localhost:${PORT}/api/search-pandas?q=${encodeURIComponent(query)}&sources=baidu,duitang`);
  const sj = await sr.json();
  const items = sj.items.slice(0, 40);
  console.log(`got ${items.length} items, analyzing...\n`);

  const rows = [];
  for (const item of items) {
    const proxyUrl = `http://localhost:${PORT}/api/proxy-image?url=${encodeURIComponent(item.src)}`;
    const data = await fetchImage(proxyUrl);
    if (!data) continue;
    const a = analyze(data.raw);
    rows.push({
      src: item.src,
      source: item.source,
      hint: (item.hint || '').slice(0, 30),
      w: data.w, h: data.h,
      sizeKB: Math.round(data.size / 1024),
      ...a,
    });
  }

  // 排序: avgSat 高 (彩色) → 低 (黑白)
  rows.sort((a, b) => b.avgSat - a.avgSat);

  console.log('排 by avgSat 降序 (高 = 彩色, AI 嫌疑):');
  console.log('| src    | hint                          | w×h     | KB | sat | wbg | bin | cur | gStd |');
  console.log('|--------|------------------------------|---------|-----|-----|-----|-----|-----|------|');
  for (const r of rows) {
    const tag = r.avgSat > 25 ? '🔴' : r.avgSat > 12 ? '🟡' : '🟢';
    console.log(
      `| ${r.source.padEnd(6)} | ${(r.hint).padEnd(30).slice(0, 30)} | ${(r.w + 'x' + r.h).padEnd(7)} | ${String(r.sizeKB).padStart(3)} | ${r.avgSat.toFixed(1).padStart(4)} | ${(r.whiteBgRatio * 100).toFixed(0).padStart(3)} | ${(r.binaryRatio * 100).toFixed(0).padStart(3)} | ${(r.colorfulRatio * 100).toFixed(0).padStart(3)} | ${r.grayStd.toFixed(1).padStart(4)} | ${tag}`
    );
  }

  console.log('\n关键 threshold 探索:');
  // avgSat 切点
  const cuts = [12, 15, 18, 20, 25, 30, 40];
  for (const cut of cuts) {
    const drop = rows.filter((r) => r.avgSat > cut).length;
    const keep = rows.length - drop;
    console.log(`  avgSat > ${cut} → drop ${drop} / keep ${keep}`);
  }
  // whiteBg 切点
  console.log('');
  const wbgCuts = [0.15, 0.25, 0.35, 0.45];
  for (const cut of wbgCuts) {
    const drop = rows.filter((r) => r.whiteBgRatio < cut).length;
    const keep = rows.length - drop;
    console.log(`  whiteBg < ${(cut * 100).toFixed(0)}% → drop ${drop} / keep ${keep}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
