// 查询扩展 — 同义词字典 + 前缀注入
//
// 用户输入 "开心" → 后端实际并行搜 ["熊猫头 开心", "熊猫头 高兴", "熊猫头 哈哈"]
// 用户输入 "打工" → 同上 ["熊猫头 打工", "熊猫头 上班", "熊猫头 搬砖"]
//
// 命中率 ↑↑ — 这是 "我们只做熊猫头, 比通用搜索更精准" 的关键

import { EMOTION_DICT } from './emotionDict';
import type { ExpansionPlan } from './types';

const MAX_VARIANTS = 8;  // 同义词字典里挑 8 个变体, 配合各源 8 query/搜
const HAS_PANDA_RE = /熊猫|panda/i;

/**
 * 查询扩展 — 用复合词大幅提升堆糖/百度匹配度.
 *
 * 例: q="开心" → 同义词 ["开心", "高兴", "哈哈"]
 *  → 堆糖复合词: ["熊猫头开心表情包", "沙雕熊猫开心", "熊猫头高兴表情包", "沙雕熊猫高兴"]
 *  → 实测堆糖 napi 模糊匹配, 复合词 hint 命中率明显高于 "熊猫头 开心" (空格分词版)
 */
export function expandQuery(raw: string): ExpansionPlan {
  const q = raw.trim().slice(0, 50);
  if (!q) {
    return { duitangQueries: [], fabiaoqingQueries: [], baiduQueries: [] };
  }

  // 收集同义词变体
  const variants = new Set<string>([q]);
  for (const [key, syns] of Object.entries(EMOTION_DICT)) {
    const qHasKey = q.includes(key);
    const qHasSyn = syns.some((s) => q.includes(s));
    if (qHasKey || qHasSyn) {
      if (qHasKey) {
        for (const s of syns) variants.add(q.replace(key, s));
      }
      for (const s of syns.slice(0, 3)) variants.add(s);
    }
  }
  const top = Array.from(variants).slice(0, MAX_VARIANTS);

  // 堆糖用复合词 (无空格) 比 "熊猫头 X" 命中率高 — 每变体生两个 (表情包 / 沙雕)
  const duitangQueries: string[] = [];
  for (const v of top) {
    if (HAS_PANDA_RE.test(v)) {
      duitangQueries.push(v);
    } else {
      duitangQueries.push(`熊猫头${v}表情包`);
      duitangQueries.push(`沙雕熊猫${v}`);
      duitangQueries.push(`${v}熊猫头`);
    }
  }

  // 百度用 "熊猫头 X 表情包" — 百度支持空格分词
  const baiduQueries: string[] = [];
  for (const v of top) {
    if (HAS_PANDA_RE.test(v)) {
      baiduQueries.push(v);
    } else {
      baiduQueries.push(`熊猫头 ${v} 表情包`);
      baiduQueries.push(`沙雕熊猫 ${v}`);
    }
  }

  // 搜狗加 panda 前缀, 两种风格
  const sogouQueries: string[] = [];
  for (const v of top) {
    if (HAS_PANDA_RE.test(v)) {
      sogouQueries.push(v);
    } else {
      sogouQueries.push(`熊猫头 ${v} 表情包`);
      sogouQueries.push(`沙雕熊猫 ${v}`);
    }
  }

  return {
    duitangQueries: Array.from(new Set(duitangQueries)).slice(0, 10),
    fabiaoqingQueries: top,
    baiduQueries: Array.from(new Set(baiduQueries)).slice(0, 8),
    sogouQueries: Array.from(new Set(sogouQueries)).slice(0, 8),
    // 360 跟 sogou 同形 (空格分词 + panda 前缀)
    so360Queries: Array.from(new Set(sogouQueries)).slice(0, 8),
    bingQueries: top.map((v) => (HAS_PANDA_RE.test(v) ? v : `${v} 熊猫头 表情包`)),
  };
}
