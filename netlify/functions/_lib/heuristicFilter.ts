// 启发式过滤 + 评分排序
// 输入: 聚合后的搜索结果 + 原始 query
// 输出: 去重 / 黑名单过滤 / 排序后的结果

import type { SearchResultItem, SourceName } from './types';

const VALID_EXT_RE = /\.(jpe?g|png|gif|webp)(\?|#|$)/i;
// 部分 CDN URL 没显式扩展名 (e.g. 百度 acjson thumbURL 是 image_search 代理路径), 这些 host 豁免扩展名检查
const EXT_LESS_CDN_RE = /(?:gimg[0-3]|img[0-2]|t[0-9]+)\.baidu\.com|mm\.bing\.net|(?:pic|img|i\d+piccdn)\.sogoucdn\.com/i;
const URL_BLACKLIST_RE = /\b(logo|banner|advert|favicon|placeholder|avatar)\b/i;
const PANDA_HINT_RE = /熊猫|panda|表情|biaoqing|meme|沙雕/i;
// 严格 panda hint: 必须有"熊猫头"三字或"沙雕熊猫"组合, 单独"表情"/"meme" 都不够
// 用于 filterAndScore 的 hard filter, 大幅提升命中率
const STRICT_PANDA_HINT_RE = /熊猫头|沙雕熊猫|panda.head/i;
// hint 含这些词 + 无 panda 关键词 → 高概率非熊猫头梗图, drop (软筛 — 含 panda 优先 keep)
// 2026-05-17 加宝可梦/动漫角色: user 反馈杰尼龟/妙蛙种子混入. 长尾词列表难穷尽,
//   核心策略仍是 colorfulness 视觉过滤兜底, 这里硬砍最常见误入角色.
const NON_PANDA_HINT_RE = /(?:cos(?:er|play)|二次元|动漫|偶像|明星|帅哥|美女|真人|写真|coser|卡通|插画|插图|手绘|绘画|素描|水彩|油画|国画|工笔|矢量|vector|illustration|摄影|照片|高清|壁纸|wallpaper|宝可梦|pokemon|皮卡丘|杰尼龟|妙蛙|小火龙|皮神|喵喵|哆啦a?梦|蜡笔小新|海绵宝宝|柯南|奥特曼|蜘蛛侠|超人|蝙蝠侠|海贼王|火影|naruto|fate|银魂|龙珠|进击的巨人|鬼灭|EVA|高达|gundam)/i;

// 2026-05-17: 极强 NON_PANDA markers — 即使 hint 含"熊猫头"也直接 drop
// 实测发现"愤怒的熊猫头脸素材图片免费下载-千库网" 之类图库 AI 图 hint 同时含 panda + 非梗图标记,
// 软筛 (NON_PANDA_HINT_RE + !PANDA_HINT_RE) 漏过. 此正则匹配商用图库 / AI 生成 hint, 强制丢.
const STRONG_NON_PANDA_RE = /千库网|图库|素材网|素材库|premium|shutterstock|istockphoto|gettyimages|adobestock|ai\s*生成|ai-generated|ai绘画|ai作画|midjourney|stable\s*diffusion|dalle|chatgpt|文心一格|stock\s*photo|stockphoto|免费下载/i;

const SOURCE_WEIGHTS: Record<SourceName, number> = {
  duitang: 1.0,
  fabiaoqing: 0.95,
  baidu: 0.85,
  so360: 0.90,
  sogou: 0.85,
  bing: 0.7,
};

export function isValidImageUrl(url: string): boolean {
  // 百度 / 必应 CDN URL 没显式扩展名 (代理转发 URL), 域名匹配后豁免扩展检查
  if (EXT_LESS_CDN_RE.test(url)) return true;
  return VALID_EXT_RE.test(url);
}

export function isAspectRatioOk(w?: number, h?: number): boolean {
  if (!w || !h) return true;
  const r = w / h;
  return r >= 0.5 && r <= 2.5;
}

export function isBlacklistedUrl(url: string): boolean {
  return URL_BLACKLIST_RE.test(url);
}

/**
 * 评分模型 v3 (2026-05-17 第二轮):
 *   user 反馈"放宽后一堆奥特曼/真熊猫照片/inside out", 又改 score-based 排序:
 *
 *   base (source weight)        = 0.7~1.0
 *   + STRICT hint ("熊猫头"等) = +3.0   // 强 boost, top of list
 *   + 普通 panda hint           = +0.5
 *   + query hit hint            = +0.5
 *   + src 含 panda              = +0.3
 *   - 无 hint                   = -0.5
 *   - 尺寸太小                  = -0.3
 *   - 尺寸太大                  = -0.1
 *
 * 排序后切 PAGE_SIZE 顶部 N → 用户优先看 STRICT (绝对熊猫头),
 *   不够再 fallback PANDA hit (可能熊猫头), 再 fallback 无 hint (兜底).
 * NON_PANDA (cos/动漫/真人) 仍 hard drop.
 */
export function scoreItem(item: SearchResultItem, q: string): number {
  let s = SOURCE_WEIGHTS[item.source] ?? 0.5;
  const hint = item.hint || '';
  const hintHasStrict = hint && STRICT_PANDA_HINT_RE.test(hint);
  const hintHasPanda = hint && PANDA_HINT_RE.test(hint);
  const hintHasQuery = q && hint && hint.toLowerCase().includes(q.toLowerCase());

  if (hintHasStrict) s += 3.0;                                // 绝对优先
  else if (hintHasPanda) s += 0.5;                            // 可能熊猫头
  if (hintHasQuery) s += 0.5;

  if (!hint) s -= 0.5;                                        // 无 hint 兜底排末尾

  if (PANDA_HINT_RE.test(item.src)) s += 0.3;

  if (item.w && item.h) {
    const px = item.w * item.h;
    if (px < 50_000) s -= 0.3;
    else if (px > 4_000_000) s -= 0.1;
  }
  return s;
}

/**
 * smart interleave by source — 防同源连续 + 保 score 优先
 *
 * 2026-05-17: score 排序后单源容易集中 (e.g. score 排前 30 全 so360 → 用户看 1 屏全 so360).
 *   纯随机打乱失去相关度. 纯 round-robin 忽略 score 分布.
 *   折中: greedy 算法 "下一张优先取 source != lastSource, 否则退而求其次取第一个".
 *
 * 实测 score 排序 [d,d,d,b,b,s,s] → interleaved [d,b,d,s,d,b,s]
 *   高 score 仍优先 (d 出 3 次 b 出 2 次 s 出 2 次, 比例不变), 但 source 不连续.
 */
function interleaveBySource<T extends { source: string }>(items: T[]): T[] {
  const remaining = items.slice();
  const out: T[] = [];
  let lastSource: string | null = null;
  while (remaining.length > 0) {
    let pickIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].source !== lastSource) {
        pickIdx = i;
        break;
      }
    }
    const picked = remaining.splice(pickIdx, 1)[0];
    out.push(picked);
    lastSource = picked.source;
  }
  return out;
}

export function filterAndScore(items: SearchResultItem[], query: string): SearchResultItem[] {
  const seen = new Set<string>();
  const out: SearchResultItem[] = [];
  for (const item of items) {
    if (!item.src || seen.has(item.src)) continue;
    seen.add(item.src);
    if (!isValidImageUrl(item.src)) continue;
    if (isBlacklistedUrl(item.src)) continue;
    if (!isAspectRatioOk(item.w, item.h)) continue;

    // STRONG NON_PANDA — 商用图库 / AI 生成 hint, 即使含"熊猫头"也直接 drop
    if (item.hint && STRONG_NON_PANDA_RE.test(item.hint)) {
      continue;
    }
    // 软筛 NON_PANDA — 含 cos/动漫/卡通 等 + 不含 panda 关键词 → drop
    if (item.hint && NON_PANDA_HINT_RE.test(item.hint) && !PANDA_HINT_RE.test(item.hint)) {
      continue;
    }

    // 2026-05-17 v3 score-based:
    //   不再 hard-drop 单凭 STRICT/PANDA hint (上轮放宽混入奥特曼+真熊猫, 收紧又量不够).
    //   全 keep 进入 scoring, STRICT_PANDA +3 boost, PANDA +0.5, 无 hint -0.5.
    //   排序后切 PAGE_SIZE 顶部 → 用户看到的优先是 STRICT 熊猫头.
    //   前端 colorfulness 视觉过滤进一步砍真彩照片 (双重防线).
    item._score = scoreItem(item, query);
    out.push(item);
  }
  out.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
  // 2026-05-17 interleave: 防单源集中 (so360 score 高时容易连占前 30, 用户体验单调)
  //   greedy 算法保 score 优先 + 同源不连续
  const interleaved = interleaveBySource(out);
  return interleaved.map(({ _score, ...rest }) => rest);
}
