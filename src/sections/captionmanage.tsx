// CaptionManage — 文案管理独立页 (DEV-only)
//
// 功能:
//   - 源池 + 用户加的全部 table 显示
//   - 源条目可"删除" (写 pmw-caption-deleted-v1 localStorage, 运行时屏蔽; 可恢复)
//   - 用户条目可编辑/删除
//   - 加新 caption (中/EN + 多模式)
//   - 多行支持 (textarea + pre-line)
//   - 导出 TS code 永久入库
//
// Contributed by PandaHead — github.com/jsybtc/panda

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Copy, Trash2, Pencil, X, Check, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  TEXTS_ZH, TEXTS_EN, ALL_MODES, MODE_LABELS,
  type Mode, type ModedText,
} from '@/data/quickModeTexts';
import {
  readUserCaptions, addUserCaption, updateUserCaption,
  deleteUserCaption, clearAllUserCaptions, exportCaptionsTSCode, exportCompleteSourceTS,
  readDeletedBaseCaptions, deleteBaseCaption, undeleteBaseCaption, clearAllDeletedBase,
  CAPTION_CHANGED_EVENT,
  type UserCaption,
} from '@/lib/captionMeta';

interface RowItem {
  id: string;
  source: 'base' | 'user';
  lang: 'zh' | 'en';
  text: string;
  tags: Mode[];
  userRef?: UserCaption;
  deleted?: boolean; // base 才有用
  ts: number;
}

interface CaptionManageProps {
  onBack: () => void;
}

export function CaptionManage({ onBack }: CaptionManageProps) {
  if (!import.meta.env.DEV) {
    return (
      <div style={{ flex: 1, padding: 40, color: '#888', textAlign: 'center' }}>
        <p>文案管理仅 DEV 模式可用</p>
        <button onClick={onBack} style={{ marginTop: 12, padding: '6px 14px' }}>返回</button>
      </div>
    );
  }
  return <CaptionManageImpl onBack={onBack} />;
}

function CaptionManageImpl({ onBack }: CaptionManageProps) {
  const [userCaps, setUserCaps] = useState<UserCaption[]>(() => readUserCaptions());
  const [deletedBase, setDeletedBase] = useState<Set<string>>(() => new Set(readDeletedBaseCaptions()));
  const [draftText, setDraftText] = useState('');
  const [draftLang, setDraftLang] = useState<'zh' | 'en'>('zh');
  const [draftTags, setDraftTags] = useState<Mode[]>(['roast']);
  const [filterLang, setFilterLang] = useState<'all' | 'zh' | 'en'>('all');
  const [filterMode, setFilterMode] = useState<'all' | Mode>('all');
  const [filterSource, setFilterSource] = useState<'all' | 'base' | 'user'>('all');
  const [showDeleted, setShowDeleted] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      setUserCaps(readUserCaptions());
      setDeletedBase(new Set(readDeletedBaseCaptions()));
    };
    window.addEventListener(CAPTION_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CAPTION_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const allRows: RowItem[] = useMemo(() => {
    const rows: RowItem[] = [];
    for (const c of userCaps) {
      rows.push({
        id: c.id, source: 'user', lang: c.lang, text: c.text, tags: c.tags, userRef: c, ts: c.ts,
      });
    }
    TEXTS_ZH.forEach((c: ModedText, i: number) => {
      rows.push({
        id: `base-zh-${i}`, source: 'base', lang: 'zh', text: c.text, tags: c.tags,
        deleted: deletedBase.has(c.text), ts: 0,
      });
    });
    TEXTS_EN.forEach((c: ModedText, i: number) => {
      rows.push({
        id: `base-en-${i}`, source: 'base', lang: 'en', text: c.text, tags: c.tags,
        deleted: deletedBase.has(c.text), ts: 0,
      });
    });
    return rows;
  }, [userCaps, deletedBase]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allRows.filter((r) => {
      if (filterLang !== 'all' && r.lang !== filterLang) return false;
      if (filterMode !== 'all' && !r.tags.includes(filterMode)) return false;
      if (filterSource !== 'all' && r.source !== filterSource) return false;
      if (!showDeleted && r.deleted) return false;
      if (q && !r.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allRows, filterLang, filterMode, filterSource, showDeleted, search]);

  const stats = useMemo(() => {
    return {
      zhBase: TEXTS_ZH.length, enBase: TEXTS_EN.length,
      userZh: userCaps.filter((c) => c.lang === 'zh').length,
      userEn: userCaps.filter((c) => c.lang === 'en').length,
      deletedCount: deletedBase.size,
      total: TEXTS_ZH.length + TEXTS_EN.length + userCaps.length,
    };
  }, [userCaps, deletedBase]);

  const toggleDraftTag = (m: Mode) => {
    setDraftTags((cur) => (cur.includes(m) ? cur.filter((t) => t !== m) : [...cur, m]));
  };

  const handleAdd = () => {
    const t = draftText.trim();
    if (!t) { toast.error('输入文案'); return; }
    if (draftTags.length === 0) { toast.error('至少选一个模式'); return; }
    addUserCaption({ text: t, lang: draftLang, tags: draftTags });
    setDraftText('');
    toast.success(`已加: ${t.replace(/\n/g, ' / ')}`);
  };

  const handleExport = async () => {
    if (userCaps.length === 0) { toast.error('还没加文案'); return; }
    const code = exportCaptionsTSCode();
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`已复制 ${userCaps.length} 条 → 粘到 quickModeTexts.ts`);
    } catch {
      toast.error('复制失败, 自行选中复制');
      console.log(code);
    }
  };

  // 一键保存到源文件 — fetch 本地 vite plugin (POST /__sync/captions) 直接写 quickModeTexts.ts
  // 后端: scripts/vite-plugin-dev-sync.ts (apply: 'serve' 仅 dev), 替换两个 TEXTS 数组
  // 写完自动清 localStorage, 因为源已含全部改动, 不再需要 DEV-only override 合入
  const handleSaveToSource = async () => {
    const deletedSet = new Set(readDeletedBaseCaptions());
    const baseZh = TEXTS_ZH.filter((t) => !deletedSet.has(t.text));
    const baseEn = TEXTS_EN.filter((t) => !deletedSet.has(t.text));
    const userZh = userCaps.filter((c) => c.lang === 'zh');
    const userEn = userCaps.filter((c) => c.lang === 'en');
    const payload = {
      zh: [...baseZh, ...userZh].map((c) => ({ text: c.text, tags: c.tags as string[] })),
      en: [...baseEn, ...userEn].map((c) => ({ text: c.text, tags: c.tags as string[] })),
    };
    try {
      const r = await fetch('/__sync/captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const result = (await r.json()) as { zh: number; en: number; file: string };
      // 写源成功 → 清 localStorage (本地状态已完全落到源文件)
      clearAllUserCaptions();
      clearAllDeletedBase();
      toast.success(`✅ 已写入 ${result.file}: ${result.zh} ZH + ${result.en} EN. Vite HMR 重 load`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`保存失败 (${msg}). 走 fallback: 复制完整源到剪贴板`);
      // Fallback: clipboard copy (跟以前一样)
      const code = exportCompleteSourceTS(
        TEXTS_ZH.map((t) => ({ text: t.text, tags: t.tags as string[] })),
        TEXTS_EN.map((t) => ({ text: t.text, tags: t.tags as string[] })),
      );
      try {
        await navigator.clipboard.writeText(code);
        toast.info('已复制完整源到剪贴板, 自行粘到 quickModeTexts.ts');
      } catch {
        console.log(code);
      }
    }
  };

  const handleClearAllUser = () => {
    if (userCaps.length === 0) return;
    if (!confirm(`确定清空 ${userCaps.length} 条用户文案?`)) return;
    clearAllUserCaptions();
    toast.success('已清空用户文案');
  };

  const handleRestoreAllDeleted = () => {
    if (deletedBase.size === 0) return;
    if (!confirm(`恢复全部 ${deletedBase.size} 条已删除的源文案?`)) return;
    clearAllDeletedBase();
    toast.success('已全部恢复');
  };

  return (
    <div style={pageStyle}>
      {/* 顶栏 */}
      <div style={headerStyle}>
        <button onClick={onBack} style={iconBtn('ghost')} title="返回编辑器">
          <ArrowLeft size={16} />
        </button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>📝 文案管理</h2>
        <span style={{ fontSize: 12, color: '#888' }}>
          总 {stats.total} ・ 源 zh/en {stats.zhBase}/{stats.enBase} ・ 用户 zh/en {stats.userZh}/{stats.userEn} ・ 已删 {stats.deletedCount}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={handleSaveToSource} style={iconBtn('accent')} title="一键写入 quickModeTexts.ts (base + 用户加 − 用户删). 走本地 vite plugin, 写完 HMR 自动 reload, 清空 localStorage.">
          <Copy size={14} /> 💾 保存到源文件
        </button>
        <button onClick={handleExport} style={iconBtn('ghost')} disabled={userCaps.length === 0} title="老式 clipboard 导出 — 仅用户加的 (append). 用 '保存到源文件' 更省事.">
          <Copy size={14} /> 仅复制用户加
        </button>
        <button onClick={handleRestoreAllDeleted} style={iconBtn('ghost')} disabled={deletedBase.size === 0}>
          <RotateCcw size={14} /> 恢复全部
        </button>
        <button onClick={handleClearAllUser} style={iconBtn('danger')} disabled={userCaps.length === 0}>
          <Trash2 size={14} /> 清空用户
        </button>
      </div>

      {/* 加新文案 */}
      <div style={addPanelStyle}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>＋ 加新文案 (回车换行 / Shift+Enter 提交)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); handleAdd(); } }}
            placeholder={draftLang === 'zh' ? '中文文案…(回车换行)' : 'EN caption…(Enter newline)'}
            rows={2}
            style={{
              flex: 1, minWidth: 200, background: '#000', border: '1px solid #2a2a2a',
              borderRadius: 4, padding: '8px 12px', color: '#fff', fontSize: 14,
              resize: 'vertical', minHeight: 44, fontFamily: 'inherit',
            }}
          />
          <SegToggle
            value={draftLang}
            options={[['zh', '中'], ['en', 'EN']]}
            onChange={(v) => setDraftLang(v as 'zh' | 'en')}
          />
          {ALL_MODES.map((m) => (
            <ModeChip key={m} mode={m} active={draftTags.includes(m)} onClick={() => toggleDraftTag(m)} />
          ))}
          <button onClick={handleAdd} disabled={!draftText.trim()} style={iconBtn('accent')}>
            <Plus size={14} /> 加
          </button>
        </div>
      </div>

      {/* 筛选 */}
      <div style={filterBarStyle}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索文案…"
          style={{
            flex: 1, minWidth: 160, background: '#0a0a0a', border: '1px solid #2a2a2a',
            borderRadius: 4, padding: '6px 12px', color: '#ddd', fontSize: 13,
          }}
        />
        <SegToggle
          value={filterLang}
          options={[['all', '全语'], ['zh', '中'], ['en', 'EN']]}
          onChange={(v) => setFilterLang(v as 'all' | 'zh' | 'en')}
        />
        <SegToggle
          value={filterSource}
          options={[['all', '全'], ['base', '源'], ['user', '用户']]}
          onChange={(v) => setFilterSource(v as 'all' | 'base' | 'user')}
        />
        <SegToggle
          value={showDeleted ? 'on' : 'off'}
          options={[['on', '含已删'], ['off', '隐已删']]}
          onChange={(v) => setShowDeleted(v === 'on')}
        />
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <ModeChip mode="all" active={filterMode === 'all'} onClick={() => setFilterMode('all')} />
          {ALL_MODES.map((m) => (
            <ModeChip key={m} mode={m} active={filterMode === m} onClick={() => setFilterMode(m)} />
          ))}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#888' }}>
          显示 {filtered.length} 条
        </span>
      </div>

      {/* 表格 */}
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr style={trHeadStyle}>
              <th style={{ ...thStyle, width: 60 }}>语言</th>
              <th style={{ ...thStyle }}>文案</th>
              <th style={{ ...thStyle, width: 240 }}>模式</th>
              <th style={{ ...thStyle, width: 60 }}>来源</th>
              <th style={{ ...thStyle, width: 100 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#666' }}>无匹配结果</td></tr>
            )}
            {filtered.map((r) => (
              <CaptionRow
                key={r.id}
                row={r}
                isEditing={editingId === r.id}
                onStartEdit={() => setEditingId(r.id)}
                onEndEdit={() => setEditingId(null)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===== 行组件 =====
function CaptionRow({ row, isEditing, onStartEdit, onEndEdit }: {
  row: RowItem;
  isEditing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
}) {
  const [draftText, setDraftText] = useState(row.text);
  const [draftTags, setDraftTags] = useState<Mode[]>(row.tags);

  useEffect(() => {
    if (isEditing) {
      setDraftText(row.text);
      setDraftTags(row.tags);
    }
  }, [isEditing, row]);

  const save = () => {
    if (!row.userRef) return;
    if (!draftText.trim()) { toast.error('文案不能空'); return; }
    updateUserCaption(row.userRef.id, { text: draftText.trim(), tags: draftTags });
    toast.success('已更新');
    onEndEdit();
  };

  const delUser = () => {
    if (!row.userRef) return;
    if (!confirm(`删除 "${row.text}"?`)) return;
    deleteUserCaption(row.userRef.id);
    toast.success('已删除');
  };

  const delBase = () => {
    if (!confirm(`删除源文案 "${row.text}"? (可恢复, 写本地 localStorage 屏蔽 runtime 抽签)`)) return;
    deleteBaseCaption(row.text);
    toast.success('已屏蔽');
  };

  const restoreBase = () => {
    undeleteBaseCaption(row.text);
    toast.success('已恢复');
  };

  // 编辑源 = 屏蔽原条 + 加一条用户版 (新文本/新 tag). 后续可继续编辑 / 一起 export TS code
  const saveBaseEdit = () => {
    if (!draftText.trim()) { toast.error('文案不能空'); return; }
    if (draftTags.length === 0) { toast.error('至少选一个模式'); return; }
    const newText = draftText.trim();
    deleteBaseCaption(row.text); // 屏蔽原条
    addUserCaption({ text: newText, lang: row.lang, tags: draftTags });
    toast.success(`已改: ${row.text.replace(/\n/g, ' / ')} → ${newText.replace(/\n/g, ' / ')}`);
    onEndEdit();
  };

  const toggleTag = (m: Mode) => {
    setDraftTags((cur) => (cur.includes(m) ? cur.filter((t) => t !== m) : [...cur, m]));
  };

  const rowBg = row.deleted
    ? 'rgba(233, 123, 123, 0.06)'
    : (row.source === 'user' ? 'rgba(255, 94, 0, 0.04)' : undefined);

  return (
    <tr style={{ ...trStyle, background: rowBg, opacity: row.deleted ? 0.55 : 1 }}>
      <td style={tdStyle}>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
          background: row.lang === 'zh' ? '#2a4a8c' : '#8c4a2a', color: '#fff',
        }}>{row.lang === 'zh' ? '中' : 'EN'}</span>
      </td>
      <td style={tdStyle}>
        {isEditing ? (
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); save(); } if (e.key === 'Escape') onEndEdit(); }}
            autoFocus
            rows={Math.max(1, draftText.split('\n').length)}
            style={{
              width: '100%', background: '#000', border: '1px solid #FF5E00',
              borderRadius: 3, padding: '4px 8px', color: '#fff', fontSize: 14,
              resize: 'vertical', fontFamily: 'inherit',
            }}
          />
        ) : (
          <span style={{
            fontSize: 14, color: '#ddd', wordBreak: 'break-word',
            whiteSpace: 'pre-line',
            textDecoration: row.deleted ? 'line-through' : 'none',
          }}>{row.text}</span>
        )}
      </td>
      <td style={tdStyle}>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {isEditing
            ? ALL_MODES.map((m) => (
                <ModeChip key={m} mode={m} active={draftTags.includes(m)} onClick={() => toggleTag(m)} size="sm" />
              ))
            : row.tags
                .filter((t) => MODE_LABELS[t]) // sanitize 老 tag
                .map((t) => (
                  <span key={t} style={tagBadge}>{MODE_LABELS[t].zh}</span>
                ))
          }
        </div>
      </td>
      <td style={tdStyle}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
          background: row.source === 'user' ? 'rgba(255, 200, 80, 0.18)' : 'rgba(255, 255, 255, 0.08)',
          color: row.source === 'user' ? '#FFC850' : '#888',
        }}>{row.source === 'user' ? '用户' : '源'}</span>
      </td>
      <td style={tdStyle}>
        {row.source === 'user'
          ? (isEditing ? (
              <div style={{ display: 'inline-flex', gap: 4 }}>
                <button onClick={save} style={iconBtn('accent', 'sm')} title="保存 (Shift+Enter)"><Check size={12} /></button>
                <button onClick={onEndEdit} style={iconBtn('ghost', 'sm')} title="取消 (Esc)"><X size={12} /></button>
              </div>
            ) : (
              <div style={{ display: 'inline-flex', gap: 4 }}>
                <button onClick={onStartEdit} style={iconBtn('ghost', 'sm')} title="编辑"><Pencil size={12} /></button>
                <button onClick={delUser} style={iconBtn('danger', 'sm')} title="删除"><Trash2 size={12} /></button>
              </div>
            ))
          : (isEditing ? (
              <div style={{ display: 'inline-flex', gap: 4 }}>
                <button onClick={saveBaseEdit} style={iconBtn('accent', 'sm')} title="保存 = 屏蔽原条 + 加一条用户版"><Check size={12} /></button>
                <button onClick={onEndEdit} style={iconBtn('ghost', 'sm')} title="取消 (Esc)"><X size={12} /></button>
              </div>
            ) : row.deleted ? (
              <button onClick={restoreBase} style={iconBtn('accent', 'sm')} title="恢复源文案">
                <RotateCcw size={12} /> 恢复
              </button>
            ) : (
              <div style={{ display: 'inline-flex', gap: 4 }}>
                <button onClick={onStartEdit} style={iconBtn('ghost', 'sm')} title="编辑源 (会屏蔽原条 + 加一条用户版)"><Pencil size={12} /></button>
                <button onClick={delBase} style={iconBtn('danger', 'sm')} title="屏蔽源文案 (可恢复)"><Trash2 size={12} /></button>
              </div>
            ))
        }
      </td>
    </tr>
  );
}

// ===== 通用小部件 =====
function ModeChip({ mode, active, onClick, size = 'md' }: {
  mode: Mode | 'all';
  active: boolean;
  onClick: () => void;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? '2px 8px' : '4px 10px';
  const fs = size === 'sm' ? 10 : 11;
  const label = MODE_LABELS[mode]?.zh ?? mode;
  return (
    <button onClick={onClick}
      style={{
        padding: pad, fontSize: fs, fontWeight: 700, borderRadius: 999,
        border: active ? '1px solid #FF5E00' : '1px solid #333',
        background: active ? 'rgba(255, 94, 0, 0.22)' : 'transparent',
        color: active ? '#FF5E00' : '#888', cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {label}
    </button>
  );
}

function SegToggle<T extends string>({ value, options, onChange }: {
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #2a2a2a', borderRadius: 4, overflow: 'hidden' }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 700,
            background: value === v ? '#FF5E00' : 'transparent',
            color: value === v ? '#fff' : '#888', border: 'none', cursor: 'pointer',
          }}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ===== styles =====
const pageStyle: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  background: '#0a0a0a', color: '#ddd', fontFamily: 'inherit',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
  borderBottom: '1px solid #2a2a2a', background: '#0f0f0f', flexWrap: 'wrap',
};
const addPanelStyle: React.CSSProperties = {
  padding: '12px 20px', borderBottom: '1px solid #2a2a2a', background: '#111',
};
const filterBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
  borderBottom: '1px solid #2a2a2a', background: '#0d0d0d', flexWrap: 'wrap',
};
const tableWrapStyle: React.CSSProperties = {
  flex: 1, overflowY: 'auto', padding: '0 20px 20px',
};
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', marginTop: 12,
};
const trHeadStyle: React.CSSProperties = {
  position: 'sticky', top: 0, background: '#0a0a0a', zIndex: 2,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700,
  color: '#888', borderBottom: '1px solid #2a2a2a', textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};
const trStyle: React.CSSProperties = { borderBottom: '1px solid #1a1a1a' };
const tdStyle: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'middle' };
const tagBadge: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
  background: 'rgba(255, 94, 0, 0.18)', color: '#FF5E00', whiteSpace: 'nowrap',
};

function iconBtn(variant: 'primary' | 'accent' | 'danger' | 'ghost', size: 'sm' | 'md' = 'md'): React.CSSProperties {
  const pal = {
    primary: { bg: '#FF5E00', color: '#fff', border: '#FF5E00' },
    accent:  { bg: '#00CC66', color: '#fff', border: '#00CC66' },
    danger:  { bg: 'transparent', color: '#E97B7B', border: '#3a3a3a' },
    ghost:   { bg: 'transparent', color: '#aaa', border: '#3a3a3a' },
  }[variant];
  const pad = size === 'sm' ? '3px 6px' : '6px 12px';
  const fs = size === 'sm' ? 11 : 13;
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: pad, fontSize: fs, fontWeight: 700, borderRadius: 4,
    background: pal.bg, color: pal.color, border: `1px solid ${pal.border}`,
    cursor: 'pointer', whiteSpace: 'nowrap',
  };
}
