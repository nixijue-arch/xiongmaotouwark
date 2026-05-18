// 实测调研: 当前 colorfulness filter 在真实搜索结果上的误杀情况
//
// 用法:
//   bun run scripts/test-colorfulness.mjs <query>
// 输出每张图的 colorfulRatio / binaryRatio / avgSat / 当前算法判定 / 推荐算法判定

import sharp from 'sharp';

const PORT = 8123;
const query = process.argv[2] || '哈哈';
const PAGE = 0;

// 跟前端 detectColorfulness 完全一致的算法 (60x60 缩放 + threshold 0.18)
function analyzeCurrent(rgba) {
  const total = 60 * 60;
  let colorfulCount = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 30 && (max - min) > 40) colorfulCount++;
  }
  return colorfulCount / total;
}

// 推荐新算法: binary-look + avgSat 综合判断
function analyzeProposed(rgba) {
  const total = 60 * 60;
  let colorfulCount = 0;
  let binaryCount = 0;
  let totalSat = 0;
  let darkCount = 0, brightCount = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const gray = (r + g + b) / 3;
    const sat = max - min;
    totalSat += sat;
    if (max > 30 && sat > 40) colorfulCount++;
    if (gray > 240 || gray < 30) binaryCount++;
    if (gray < 30) darkCount++;
    if (gray > 240) brightCount++;
  }
  const colorfulRatio = colorfulCount / total;
  const binaryRatio = binaryCount / total;
  const avgSat = totalSat / total;
  return { colorfulRatio, binaryRatio, avgSat, darkRatio: darkCount / total, brightRatio: brightCount / total };
}

async function fetchImageRGBA(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // 缩到 60x60, 强转 raw RGBA
    const raw = await sharp(buf).resize(60, 60, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    return raw;
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log(`[test-colorfulness] query="${query}" page=${PAGE}\n`);

  const searchUrl = `http://localhost:${PORT}/api/search-pandas?q=${encodeURIComponent(query)}&page=${PAGE}`;
  const sr = await fetch(searchUrl);
  if (!sr.ok) {
    console.error('search failed:', sr.status);
    process.exit(1);
  }
  const sj = await sr.json();
  const items = sj.items.slice(0, 60);  // 头 60 张采样
  console.log(`got ${items.length} items, analyzing...\n`);

  let cur_kept = 0, cur_dropped = 0;
  let new_kept = 0, new_dropped = 0;
  // 比较: 当前算法 drop, 但新算法 keep (= 当前可能误杀)
  const cur_drop_new_keep = [];
  // 当前算法 keep, 但新算法 drop (= 真彩照新算法多砍)
  const cur_keep_new_drop = [];
  // 两个都 drop
  const both_drop = [];
  // 两个都 keep
  const both_keep_sample = [];

  for (const item of items) {
    const proxyUrl = `http://localhost:${PORT}/api/proxy-image?url=${encodeURIComponent(item.src)}`;
    const rgba = await fetchImageRGBA(proxyUrl);
    if (!rgba) {
      console.log(`  [skip] ${item.id} (load fail)`);
      continue;
    }
    const cur = analyzeCurrent(rgba);
    const np = analyzeProposed(rgba);

    // 当前算法: colorfulRatio > 0.18 = isColorful = drop
    const cur_drop = cur > 0.18;
    // 推荐新算法:
    //   isBinaryPanda = binaryRatio > 0.55 && avgSat < 20  (强 binary 直接 keep)
    //   isColorful = colorfulRatio > 0.14 || avgSat > 28
    //   shouldShow = isBinaryPanda || !isColorful
    const isBinaryPanda = np.binaryRatio > 0.55 && np.avgSat < 20;
    const isColorful = np.colorfulRatio > 0.14 || np.avgSat > 28;
    const new_drop = !isBinaryPanda && isColorful;

    if (cur_drop) cur_dropped++; else cur_kept++;
    if (new_drop) new_dropped++; else new_kept++;

    const row = {
      id: item.id.slice(0, 30),
      hint: (item.hint || '').slice(0, 30),
      cur: cur.toFixed(3),
      bin: np.binaryRatio.toFixed(3),
      sat: np.avgSat.toFixed(1),
      cur_drop,
      new_drop,
      src: item.src,
    };

    if (cur_drop && !new_drop) cur_drop_new_keep.push(row);
    else if (!cur_drop && new_drop) cur_keep_new_drop.push(row);
    else if (cur_drop && new_drop) both_drop.push(row);
    else both_keep_sample.push(row);
  }

  console.log('================================');
  console.log('📊 总体统计');
  console.log('================================');
  console.log(`总采样: ${items.length} 张`);
  console.log(`\n当前算法 (colorfulRatio > 0.18 = drop):`);
  console.log(`  keep: ${cur_kept}  drop: ${cur_dropped}`);
  console.log(`\n推荐新算法 (binary-look 优先 + 综合 sat):`);
  console.log(`  keep: ${new_kept}  drop: ${new_dropped}`);
  console.log(`\n差异:`);
  console.log(`  🟢 当前 drop / 新 keep: ${cur_drop_new_keep.length} 张 (可能挽回的"有意思熊猫头")`);
  console.log(`  🔴 当前 keep / 新 drop: ${cur_keep_new_drop.length} 张 (新算法多砍的)`);
  console.log(`  🚫 两算法都 drop: ${both_drop.length} 张`);
  console.log(`  ✅ 两算法都 keep: ${both_keep_sample.length} 张`);

  console.log(`\n================================`);
  console.log('🟢 当前算法误杀候选 (drop) — 新算法救回 (keep). 看 hint 判断:');
  console.log('================================');
  for (const r of cur_drop_new_keep.slice(0, 20)) {
    console.log(`  cur=${r.cur} bin=${r.bin} sat=${r.sat} | "${r.hint}" | ${r.src}`);
  }

  console.log(`\n================================`);
  console.log('🔴 新算法新增 drop (当前 keep) — 看是否真彩照应砍:');
  console.log('================================');
  for (const r of cur_keep_new_drop.slice(0, 15)) {
    console.log(`  cur=${r.cur} bin=${r.bin} sat=${r.sat} | "${r.hint}" | ${r.src}`);
  }

  console.log(`\n================================`);
  console.log('🚫 两算法都 drop 样本 (看是否真非熊猫头):');
  console.log('================================');
  for (const r of both_drop.slice(0, 10)) {
    console.log(`  cur=${r.cur} bin=${r.bin} sat=${r.sat} | "${r.hint}" | ${r.src}`);
  }

  console.log(`\n================================`);
  console.log('✅ 两算法都 keep 样本 (看 binary panda 特征):');
  console.log('================================');
  for (const r of both_keep_sample.slice(0, 10)) {
    console.log(`  cur=${r.cur} bin=${r.bin} sat=${r.sat} | "${r.hint}" | ${r.src.slice(0,80)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
