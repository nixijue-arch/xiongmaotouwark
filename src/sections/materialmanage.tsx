// MaterialManage — 素材管理独立页 (DEV-only)
//
// 功能:
//   - 70 panda + 132 face 全部 table 显示
//   - 编辑 labelCn / labelEn / hidden / tags
//   - 缩略图 + 搜索 + 按 mode 筛 + 按 tab(panda/face) 切
//   - 导出 TS code 永久入库
//
// Contributed by PandaHead — github.com/jokkibtc/panda

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, Trash2, RotateCcw, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { ALL_PANDAS, ALL_FACES, type Material } from '@/data/materials';
import {
  readMaterialMeta, saveMaterialMetaEntry, clearMaterialMetaEntry,
  clearAllMaterialMeta, exportMaterialMetaTSCode, MATERIAL_META_CHANGED_EVENT,
  type MaterialMeta,
} from '@/lib/materialMeta';
import { ALL_MODES, MODE_LABELS, type Mode } from '@/data/quickModeTexts';

interface MaterialManageProps {
  onBack: () => void;
}

export function MaterialManage({ onBack }: MaterialManageProps) {
  if (!import.meta.env.DEV) {
    return (
      <div style={{ flex: 1, padding: 40, color: '#888', textAlign: 'center' }}>
        <p>素材管理仅 DEV 模式可用</p>
        <button onClick={onBack} style={{ marginTop: 12, padding: '6px 14px' }}>返回</button>
      </div>
    );
  }
  return <MaterialManageImpl onBack={onBack} />;
}

function MaterialManageImpl({ onBack }: MaterialManageProps) {
  const [meta, setMeta] = useState<MaterialMeta>(() => readMaterialMeta());
  const [tab, setTab] = useState<'panda' | 'face'>('panda');
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | Mode>('all');
  const [filterHidden, setFilterHidden] = useState<'all' | 'shown' | 'hidden'>('shown');

  useEffect(() => {
    const refresh = () => setMeta(readMaterialMeta());
    window.addEventListener(MATERIAL_META_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(MATERIAL_META_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const baseList: Material[] = tab === 'panda' ? ALL_PANDAS : ALL_FACES;

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return baseList.filter((m) => {
      const e = meta[m.id];
      const labelCn = e?.labelCn ?? m.labelCn;
      const labelEn = e?.labelEn ?? m.labelEn;
      const hidden = Boolean(e?.hidden);
      const tags = e?.tags ?? [];
      if (filterHidden === 'shown' && hidden) return false;
      if (filterHidden === 'hidden' && !hidden) return false;
      if (filterMode !== 'all' && !tags.includes(filterMode)) return false;
      if (q) {
        const hay = `${m.id} ${labelCn} ${labelEn}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [baseList, meta, search, filterMode, filterHidden]);

  const stats = useMemo(() => {
    const total = baseList.length;
    const overridden = baseList.filter((m) => meta[m.id]).length;
    const hidden = baseList.filter((m) => meta[m.id]?.hidden).length;
    const tagged = baseList.filter((m) => meta[m.id]?.tags?.length).length;
    return { total, overridden, hidden, tagged };
  }, [baseList, meta]);

  const handleExport = async () => {
    const code = exportMaterialMetaTSCode();
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`已复制 ${Object.keys(meta).length} 条 override → 粘到 material-meta-overrides.ts`);
    } catch {
      toast.error('复制失败, 自行选中复制');
      console.log(code);
    }
  };

  const handleClearAll = () => {
    if (Object.keys(meta).length === 0) return;
    if (!confirm(`确定清空全部 ${Object.keys(meta).length} 条 override?`)) return;
    clearAllMaterialMeta();
    toast.success('已清空');
  };

  return (
    <div style={pageStyle}>
      {/* 顶栏 */}
      <div style={headerStyle}>
        <button onClick={onBack} style={iconBtn('ghost')}>
          <ArrowLeft size={16} />
        </button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>📋 素材管理</h2>
        <span style={{ fontSize: 12, color: '#888' }}>
          {tab === 'panda' ? `${stats.total} 熊猫头` : `${stats.total} 人脸`} ・
          已 override {stats.overridden} ・ 隐藏 {stats.hidden} ・ 已打 tag {stats.tagged}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} style={iconBtn('primary')} disabled={Object.keys(meta).length === 0}>
          <Copy size={14} /> 导出 TS code
        </button>
        <button onClick={handleClearAll} style={iconBtn('danger')} disabled={Object.keys(meta).length === 0}>
          <Trash2 size={14} /> 清空全部
        </button>
      </div>

      {/* 筛选 */}
      <div style={filterBarStyle}>
        <SegToggle
          value={tab}
          options={[['panda', `🐼 熊猫头 ${ALL_PANDAS.length}`], ['face', `😀 人脸 ${ALL_FACES.length}`]]}
          onChange={(v) => setTab(v as 'panda' | 'face')}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索 ID / 名称…"
          style={{
            flex: 1, minWidth: 160, background: '#0a0a0a', border: '1px solid #2a2a2a',
            borderRadius: 4, padding: '6px 12px', color: '#ddd', fontSize: 13,
          }}
        />
        <SegToggle
          value={filterHidden}
          options={[['all', '全部'], ['shown', '显示'], ['hidden', '隐藏']]}
          onChange={(v) => setFilterHidden(v as 'all' | 'shown' | 'hidden')}
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
              <th style={{ ...thStyle, width: 60 }}>缩略</th>
              <th style={{ ...thStyle, width: 180 }}>ID</th>
              <th style={{ ...thStyle, width: 160 }}>中文名</th>
              <th style={{ ...thStyle, width: 160 }}>英文名</th>
              <th style={{ ...thStyle, width: 240 }}>模式</th>
              <th style={{ ...thStyle, width: 180 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#666' }}>无匹配</td></tr>
            )}
            {filtered.map((m) => (
              <MaterialRow key={m.id} m={m} entry={meta[m.id]} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MaterialRow({ m, entry }: { m: Material; entry?: { labelCn?: string; labelEn?: string; hidden?: boolean; tags?: Mode[] } }) {
  const labelCn = entry?.labelCn ?? '';
  const labelEn = entry?.labelEn ?? '';
  const hidden = Boolean(entry?.hidden);
  // v5: sanitize 老 tag (废弃的 'abstract' 等) 防 MODE_LABELS 解引用空导致白屏
  const tags: Mode[] = (entry?.tags ?? []).filter((t) => (ALL_MODES as string[]).includes(t)) as Mode[];
  const labelCnRef = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<{ labelCn: string; labelEn: string; hidden: boolean; tags: Mode[] }>) => {
    saveMaterialMetaEntry(m.id, p);
  };

  const toggleTag = (mode: Mode) => {
    const next = tags.includes(mode) ? tags.filter((t) => t !== mode) : [...tags, mode];
    patch({ tags: next });
  };

  const reset = () => {
    clearMaterialMetaEntry(m.id);
    toast.success(`已重置 ${m.id}`);
  };

  const focusEdit = () => {
    labelCnRef.current?.focus();
    labelCnRef.current?.select();
  };

  return (
    <tr style={{ ...trStyle, opacity: hidden ? 0.45 : 1 }}>
      <td style={tdStyle}>
        <img src={m.src} alt={m.id} style={{
          width: 40, height: 40, objectFit: 'contain', background: '#fff',
          borderRadius: 4, border: '1px solid #2a2a2a',
          filter: hidden ? 'grayscale(1)' : undefined,
        }} />
      </td>
      <td style={tdStyle}>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#888', wordBreak: 'break-all' }}>{m.id}</div>
        <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>原: {m.labelCn} / {m.labelEn}</div>
      </td>
      <td style={tdStyle}>
        <input
          ref={labelCnRef}
          type="text"
          value={labelCn}
          onChange={(e) => patch({ labelCn: e.target.value })}
          placeholder={m.labelCn}
          style={inputStyle}
        />
      </td>
      <td style={tdStyle}>
        <input
          type="text"
          value={labelEn}
          onChange={(e) => patch({ labelEn: e.target.value })}
          placeholder={m.labelEn}
          style={inputStyle}
        />
      </td>
      <td style={tdStyle}>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {ALL_MODES.map((mode) => (
            <ModeChip
              key={mode}
              mode={mode}
              active={tags.includes(mode)}
              onClick={() => toggleTag(mode)}
              size="sm"
            />
          ))}
        </div>
      </td>
      <td style={tdStyle}>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <button onClick={focusEdit} style={iconBtn('ghost', 'sm')} title="编辑 (聚焦中文名输入)">
            <Pencil size={12} />
          </button>
          <button
            onClick={() => patch({ hidden: !hidden })}
            style={iconBtn(hidden ? 'accent' : 'danger', 'sm')}
            title={hidden ? '取消屏蔽 (用户端 picker 重新显示)' : '屏蔽 (用户端 picker 不显示, 素材不删除)'}
          >
            {hidden ? <RotateCcw size={12} /> : <Trash2 size={12} />}
          </button>
          {entry && (
            <button onClick={reset} style={iconBtn('ghost', 'sm')} title="重置该条 override (清掉 label/tag/hidden)">
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ===== 通用小部件 (复用 captionmanage 的样式) =====
function ModeChip({ mode, active, onClick, size = 'md' }: {
  mode: Mode | 'all';
  active: boolean;
  onClick: () => void;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? '2px 8px' : '4px 10px';
  const fs = size === 'sm' ? 10 : 11;
  return (
    <button onClick={onClick}
      style={{
        padding: pad, fontSize: fs, fontWeight: 700, borderRadius: 999,
        border: active ? '1px solid #FF5E00' : '1px solid #333',
        background: active ? 'rgba(255, 94, 0, 0.22)' : 'transparent',
        color: active ? '#FF5E00' : '#888', cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {MODE_LABELS[mode].zh}
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
  borderBottom: '1px solid #2a2a2a', background: '#0f0f0f',
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
  color: '#888', borderBottom: '1px solid #2a2a2a',
  textTransform: 'uppercase' as const, letterSpacing: '0.05em',
};
const trStyle: React.CSSProperties = { borderBottom: '1px solid #1a1a1a' };
const tdStyle: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'middle' };
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0a0a0a', border: '1px solid #2a2a2a',
  borderRadius: 3, padding: '4px 8px', color: '#ddd', fontSize: 12,
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
