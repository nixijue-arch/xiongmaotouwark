// 联网搜熊猫头表情包 — 通用搜索面板
//
// 2026-05-17 v4 (用户反馈"框太小+滚动卡 bug, 重新设计前端"):
//   - LeftSidebar 改成按钮触发 PandaSearchModal (全屏), 不再嵌入 sidebar → embedded prop 废弃
//   - QuickMode 也用自己的 modal wrapper. 本组件只服务"在固定高度容器内 grid 滚"场景
//   - "裁底部文字" v2: 纯几何 crop 22% (前 inpaint 检测算法 → 卡死风险)
//   - onSelect 单一回调, caller 决定如何应用 (覆盖 panda / setCustomPanda / etc.)

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X, Loader2, AlertCircle, Star, Shuffle } from 'lucide-react';
import { toast } from 'sonner';
import { useMeme } from '@/context/memecontext';
import { CHIP_DEFS, type ChipDef } from '@/data/emotionDict';
import {
  searchPandas,
  makeNetworkMaterial,
  proxyImageUrl,
  proxyForCanvasDetect,
  detectColorfulness,
  detectAIPanda,
  type NetworkResult,
  type SearchResponse,
} from '@/lib/networkImage';
import type { Material } from '@/data/materials';
import './pandasearchpanel.css';

export interface PandaSearchPanelProps {
  /** 点击卡片回调 — caller 决定怎么应用 material */
  onSelect: (material: Material, result: NetworkResult) => void | Promise<void>;
  /** DEV-only ⭐ 沉淀 */
  onSaveToPool?: (result: NetworkResult) => void;
  lang: 'zh' | 'en';
  initialQuery?: string;
}

const SEARCH_DEBOUNCE_MS = 300;

export function PandaSearchPanel(props: PandaSearchPanelProps) {
  const { onSelect, onSaveToPool, initialQuery = '' } = props;
  const { t } = useMeme();

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<NetworkResult[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resHint, setResHint] = useState<SearchResponse['hint']>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 视觉过滤 (后台 lazy 检测, 默认开启):
  //   - colorfulDetection: 极端彩色 (colorfulRatio > 0.18) — 真彩照片 / 商用素材
  //   - aiPandaDetection: 高饱和 + 无白底 (avgSat > 28 && whiteBg < 10%) — AI 生成 "真实风格熊猫"
  // 实测 350+ 张 0 误杀真黑白 meme.
  const [colorfulDetection, setColorfulDetection] = useState<Record<string, boolean>>({});
  const [aiPandaDetection, setAIPandaDetection] = useState<Record<string, boolean>>({});
  // 加载失败的图: img onError 直接从 grid 移除 (so360 部分 thumb 偶尔 404, 不显示"加载失败"占位)
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const markImgFailed = useCallback((id: string) => {
    setFailedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);  // psp-root = 滚动容器 (IO observe root)
  const debounceRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const featuredChips = useMemo(
    () => CHIP_DEFS.filter((c) => c.featured),
    [],
  );

  const doSearch = useCallback(async (q: string, pg: number) => {
    if (!q.trim()) {
      setResults([]);
      setHasMore(false);
      setError(null);
      setResHint(undefined);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const resp = await searchPandas(q, pg, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setResults((prev) => (pg === 0 ? resp.items : [...prev, ...resp.items]));
      setHasMore(resp.hasMore);
      setResHint(resp.hint);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const msg = (e as Error).message ?? 'unknown';
      if (!msg.toLowerCase().includes('abort')) {
        setError(msg);
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    // ⭐ query 变化立即清屏 + abort 旧 fetch (修"切搜索卡在旧结果半分钟"):
    //   旧实现: setResults 只在 fetch 返回时调用 → 用户切 query 后等新 fetch 完成才换屏
    //   现在: 立刻 abort + clear, 用户感觉切 query 瞬间响应
    abortRef.current?.abort();
    if (query.trim()) {
      setResults([]);
      setFailedIds(new Set());
      setColorfulDetection({});
      setAIPandaDetection({});
      setError(null);
      setHasMore(false);
      setResHint(undefined);
    }
    debounceRef.current = window.setTimeout(() => {
      setPage(0);
      void doSearch(query, 0);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  // 视觉过滤: 后台 lazy 检测每个 result 是否是彩色照片 (非熊猫头梗图)
  // 默认开启 — 大多数 user 都希望搜出来 100% 是熊猫头梗图
  // detect 并行化 (v2, 2026-05-17):
  //   旧实现: for..of await 100 张串行 + setState/张 → 30s+ 卡顿 + 多次重排抖动
  //   新实现: Promise.all 全部并行 (浏览器自己限 6 concurrent img load) → ~1-2s 全完
  //           1 次 setState 合并入 prev → grid 只重排 1 次
  useEffect(() => {
    let cancelled = false;
    const todo = results.filter((r) => colorfulDetection[r.id] === undefined || aiPandaDetection[r.id] === undefined);
    if (todo.length === 0) return;
    (async () => {
      // detect 用 canvas getImageData 必须 same-origin, 固定走 proxy
      const entries = await Promise.all(
        todo.map(async (r) => {
          const url = proxyForCanvasDetect(r.thumb || r.src);
          const [isColorful, isAIPanda] = await Promise.all([
            detectColorfulness(url).catch(() => false),
            detectAIPanda(url).catch(() => false),
          ]);
          return { id: r.id, isColorful, isAIPanda };
        }),
      );
      if (cancelled || !mountedRef.current) return;
      // 1 次 setState 合并所有结果 → grid 单次重排, 视觉稳定
      setColorfulDetection((prev) => {
        const next = { ...prev };
        for (const e of entries) next[e.id] = e.isColorful;
        return next;
      });
      setAIPandaDetection((prev) => {
        const next = { ...prev };
        for (const e of entries) next[e.id] = e.isAIPanda;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [results, colorfulDetection, aiPandaDetection]);

  // IntersectionObserver — root = pspRoot (root 是 overflow scroll 容器)
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          setPage((prevPage) => {
            const next = prevPage + 1;
            void doSearch(query, next);
            return next;
          });
        }
      },
      { root: rootRef.current, rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, query, doSearch]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const onChipClick = useCallback((chip: ChipDef) => {
    const term = chip.terms[0];
    if (term) setQuery(term);
  }, []);

  const onRandomSearch = useCallback(() => {
    if (featuredChips.length === 0) return;
    const c = featuredChips[Math.floor(Math.random() * featuredChips.length)];
    if (c?.terms[0]) setQuery(c.terms[0]);
  }, [featuredChips]);

  // 极简化 handleSelect (2026-05-17 v6):
  //   user 反馈"修了十几次裁底都不能用" + "点击图片后不会加载到画板".
  //   决定砍掉所有可能卡死的逻辑 — 0 await race / 0 Promise.race / 0 timer.
  //   流程: 构造 mat (同步) → onSelect (可能 sync 也可能 async, await 兼容) → toast.
  //   加 console.log 让 user F12 console 看实际调用链, 报 bug 直接粘.
  const handleSelect = useCallback(
    async (result: NetworkResult) => {
      if (busyId) return;
      setBusyId(result.id);
      const toastId = 'psp-action';
      toast.dismiss(toastId);

      const finalSrc = proxyImageUrl(result.src);
      const mat: Material = {
        id: `network-panda-${result.id.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 32)}`,
        src: finalSrc,
        labelCn: (result.hint?.trim() || '网络熊猫').slice(0, 12),
        labelEn: 'Network Panda',
        tags: [],
        tagsEn: [],
        faceOffset: { x: 100, y: 70, w: 250, h: 250 },
        kind: 'network',
      };
      // makeNetworkMaterial export 保留兼容性
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _unused = makeNetworkMaterial;

      // eslint-disable-next-line no-console
      console.log('[PSP] handleSelect →', {
        result: { id: result.id, source: result.source, hint: result.hint?.slice(0, 30) },
        mat: { id: mat.id, srcPrefix: mat.src.slice(0, 60), srcLen: mat.src.length },
      });

      try {
        await onSelect(mat, result);
        // eslint-disable-next-line no-console
        console.log('[PSP] onSelect resolved ✓ (caller dispatched / setCustomPanda done)');
        toast.success(
          props.lang === 'zh' ? '已应用' : 'Applied',
          { id: toastId, duration: 2000 },
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[PSP] onSelect rejected ✗', { result, error: e });
        toast.error(
          `${t('networkSearchFetchFail')}: ${(e as Error).message ?? 'unknown'}`,
          { id: toastId, duration: 4000 },
        );
      } finally {
        if (mountedRef.current) setBusyId(null);
      }
    },
    [busyId, onSelect, t, props.lang],
  );

  const handleSave = useCallback(
    (result: NetworkResult) => {
      if (!onSaveToPool) return;
      onSaveToPool(result);
    },
    [onSaveToPool],
  );

  const showSaveBtn = Boolean(onSaveToPool) && import.meta.env.DEV;

  return (
    <div className="psp-root" ref={rootRef}>
      {/* 搜索框 (移除右侧 🎲, 改为 hint state 中间显示) */}
      <div className="material-search-box psp-search">
        <Search size={14} color="#888" />
        <input
          type="text"
          className="material-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('networkSearchPlaceholder')}
          aria-label={t('networkSearch')}
        />
        {query && (
          <button
            className="material-search-clear"
            onClick={() => setQuery('')}
            aria-label="clear"
            type="button"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* chip 行 (精选) — active 用 label 严格匹配, 一个 query 只点亮一个 chip
       * (旧用 terms.includes 出现 "狂喜" terms 含 "过年" 双亮 bug, 已根治) */}
      <div className="psp-chip-row">
        {featuredChips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            className={`psp-chip ${chip.label === query ? 'psp-chip-active' : ''}`}
            onClick={() => onChipClick(chip)}
            title={chip.terms.join(' / ')}
          >
            <span className="psp-chip-emoji">{chip.emoji}</span>
            <span className="psp-chip-label">{chip.label}</span>
          </button>
        ))}
      </div>

      {/* 裁底功能 v6 移除 — user 反馈"修了十几次都不能用",
       *   实施层面 (canvas inpaint / 几何 crop) 都有 corner case 卡顿,
       *   且用户感知度低 (砍 22% 看不出明显差异).
       *   eraseBottomText 函数保留在 networkImage.ts 备用 (未来 OCR 方案可能复用). */}

      {/* partial banner 删除 — sogou 经常返 0 (备用源), partial 几乎总是触发 → 视觉噪音过大.
       *   只保留 all_sources_failed (下面 error 已覆盖) 跟用户真正 error 反馈. */}

      {error && (
        <div className="psp-banner psp-banner-error">
          <AlertCircle size={14} />
          <span>{t('networkSearchError')}</span>
          <button
            type="button"
            className="psp-banner-retry"
            onClick={() => {
              setPage(0);
              void doSearch(query, 0);
            }}
          >
            {t('networkSearchRetry')}
          </button>
        </div>
      )}

      <div className="psp-grid">
        {results
          .filter((item) =>
            colorfulDetection[item.id] !== true &&
            aiPandaDetection[item.id] !== true &&
            !failedIds.has(item.id)  // 加载失败的图直接不渲染 (so360 thumb 偶尔 404)
          )
          .map((item) => (
            <ResultCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              disabled={Boolean(busyId)}
              showSaveBtn={showSaveBtn}
              onLoadFailed={() => markImgFailed(item.id)}
              tFrom={t('networkSearchSourceFrom')}
              tSave={t('networkSearchSave')}
              onSelect={() => void handleSelect(item)}
              onSave={() => handleSave(item)}
            />
          ))}
      </div>

      {hasMore && !loading && (
        <div ref={sentinelRef} className="psp-sentinel" aria-hidden="true" />
      )}

      {loading && (
        <div className="psp-loading">
          <Loader2 size={18} className="psp-spinner" />
          <span>{t('networkSearchLoading')}</span>
        </div>
      )}

      {!loading && !error && query.trim() && results.length === 0 && (
        <div className="psp-empty">{t('networkSearchEmpty')}</div>
      )}

      {/* hint state: 文案 + 大 🎲 按钮居中 */}
      {!loading && !error && !query.trim() && results.length === 0 && (
        <div className="psp-hint">
          <div className="psp-hint-text">{t('networkSearchHint')}</div>
          <button
            type="button"
            className="psp-random-big"
            onClick={onRandomSearch}
            aria-label="random search"
          >
            <Shuffle size={14} />
            <span>{props.lang === 'zh' ? '随机一搜' : 'Random search'}</span>
          </button>
        </div>
      )}

      {!hasMore && results.length > 0 && !loading && (
        <div className="psp-end">— {t('networkSearchAllLoaded')} —</div>
      )}
    </div>
  );
}

interface ResultCardProps {
  item: NetworkResult;
  busy: boolean;
  disabled: boolean;
  showSaveBtn: boolean;
  tFrom: string;
  tSave: string;
  onSelect: () => void;
  onSave: () => void;
  /** img 加载失败时通知上层从 grid 移除 (so360 thumb 偶尔 404) */
  onLoadFailed: () => void;
}

function ResultCard({
  item,
  busy,
  disabled,
  showSaveBtn,
  tFrom,
  tSave,
  onSelect,
  onSave,
  onLoadFailed,
}: ResultCardProps) {
  const thumbSrc = proxyImageUrl(item.thumb || item.src);

  return (
    <div
      className={[
        'psp-card',
        busy ? 'psp-card-busy' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => { if (!disabled) onSelect(); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <img
        src={thumbSrc}
        loading="lazy"
        alt={item.hint || item.source}
        className="psp-thumb"
        style={item.w && item.h ? { aspectRatio: `${item.w} / ${item.h}` } : { aspectRatio: '1 / 1' }}
        onError={onLoadFailed}
        draggable={false}
      />
      {/* source badge 仅 DEV 显示 — 生产端用户不需知道图源 */}
      {import.meta.env.DEV && (
        <span className="psp-source-badge" aria-hidden="true" title={`${tFrom} ${item.source}`}>
          {item.source}
        </span>
      )}
      {busy && (
        <div className="psp-card-busy-mask">
          <Loader2 size={20} className="psp-spinner" />
        </div>
      )}
      {showSaveBtn && !busy && (
        <button
          type="button"
          className="psp-save-corner"
          onClick={(e) => {
            e.stopPropagation();
            onSave();
          }}
          title={tSave}
          disabled={disabled}
          aria-label="save to pool"
        >
          <Star size={12} />
        </button>
      )}
    </div>
  );
}
