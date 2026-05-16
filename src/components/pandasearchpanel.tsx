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
  detectColorfulness,
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
  // 视觉过滤: 后台检测每个 result 是否是彩色照片 (非熊猫头梗图), 自动过滤掉
  // 不需要 user toggle — 默认开启 (用户都期望搜出来全是熊猫头)
  const [colorfulDetection, setColorfulDetection] = useState<Record<string, boolean>>({});

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
  useEffect(() => {
    let cancelled = false;
    const todo = results.filter((r) => colorfulDetection[r.id] === undefined);
    if (todo.length === 0) return;
    (async () => {
      for (const r of todo) {
        if (cancelled || !mountedRef.current) return;
        try {
          const isColorful = await detectColorfulness(proxyImageUrl(r.thumb || r.src));
          if (cancelled || !mountedRef.current) return;
          setColorfulDetection((prev) => ({ ...prev, [r.id]: isColorful }));
        } catch {
          if (cancelled || !mountedRef.current) return;
          setColorfulDetection((prev) => ({ ...prev, [r.id]: false }));
        }
        await new Promise((res) => setTimeout(res, 20));
      }
    })();
    return () => { cancelled = true; };
  }, [results, colorfulDetection]);

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

      {resHint === 'partial' && (
        <div className="psp-banner psp-banner-info">{t('networkSearchPartial')}</div>
      )}

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
          .filter((item) => colorfulDetection[item.id] !== true)
          .map((item) => (
            <ResultCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              disabled={Boolean(busyId)}
              showSaveBtn={showSaveBtn}
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
}: ResultCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const thumbSrc = proxyImageUrl(item.thumb || item.src);

  return (
    <div
      className={[
        'psp-card',
        busy ? 'psp-card-busy' : '',
        imgFailed ? 'psp-card-failed' : '',
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
      {imgFailed ? (
        <div className="psp-thumb-fallback">
          <span aria-hidden="true">🖼️</span>
          <small>加载失败</small>
        </div>
      ) : (
        <img
          src={thumbSrc}
          loading="lazy"
          alt={item.hint || item.source}
          className="psp-thumb"
          style={item.w && item.h ? { aspectRatio: `${item.w} / ${item.h}` } : { aspectRatio: '1 / 1' }}
          onError={() => setImgFailed(true)}
          draggable={false}
        />
      )}
      <span className="psp-source-badge" aria-hidden="true" title={`${tFrom} ${item.source}`}>
        {item.source}
      </span>
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
