// 图源注册表 + 并行调度器

import { duitangAdapter } from './duitang';
import { fabiaoqingAdapter } from './fabiaoqing';
import { baiduAdapter } from './baidu';
import { sogouAdapter } from './sogou';
import type {
  ExpansionPlan,
  SearchResponse,
  SearchResultItem,
  SourceAdapter,
  SourceName,
} from '../types';

const ALL_SOURCES: SourceAdapter[] = [duitangAdapter, fabiaoqingAdapter, baiduAdapter, sogouAdapter];

const MAX_QUERIES_PER_SOURCE = 8; // 8 个 query 变体 × 3 源 = 600+ 候选, 过滤后留 ~200/页

export function getEnabledSources(filter?: Set<string>): SourceAdapter[] {
  return ALL_SOURCES.filter((s) => s.enabled()).filter((s) => !filter || filter.has(s.name));
}

function queriesForSource(name: SourceName, plan: ExpansionPlan): string[] {
  if (name === 'duitang') return plan.duitangQueries;
  if (name === 'fabiaoqing') return plan.fabiaoqingQueries;
  if (name === 'baidu') return plan.baiduQueries ?? [];
  if (name === 'sogou') return plan.sogouQueries ?? [];
  if (name === 'bing') return plan.bingQueries ?? [];
  return [];
}

interface RunResult {
  items: SearchResultItem[];
  perSource: SearchResponse['sources'];
}

export async function runAllSources(
  plan: ExpansionPlan,
  page: number,
  filter?: Set<string>,
): Promise<RunResult> {
  const sources = getEnabledSources(filter);
  const perSource: SearchResponse['sources'] = {};
  const tasks: Promise<SearchResultItem[]>[] = [];

  for (const source of sources) {
    const queries = queriesForSource(source.name, plan).slice(0, MAX_QUERIES_PER_SOURCE);
    if (queries.length === 0) continue;
    const start = Date.now();
    const task = (async () => {
      try {
        const settled = await Promise.allSettled(queries.map((q) => source.search(q, page)));
        const got: SearchResultItem[] = [];
        let firstError: string | undefined;
        let okCount = 0;
        for (const r of settled) {
          if (r.status === 'fulfilled') {
            got.push(...r.value);
            okCount++;
          } else if (!firstError) {
            firstError = (r.reason as Error)?.message || String(r.reason);
          }
        }
        perSource[source.name] = {
          ok: okCount > 0,
          took: Date.now() - start,
          count: got.length,
          error: okCount === 0 ? firstError : undefined,
        };
        return got;
      } catch (e) {
        perSource[source.name] = {
          ok: false,
          took: Date.now() - start,
          count: 0,
          error: (e as Error)?.message || String(e),
        };
        return [];
      }
    })();
    tasks.push(task);
  }

  const all = (await Promise.all(tasks)).flat();
  return { items: all, perSource };
}
