// 沉淀工具 modal — DEV-only
// 用户点 PandaSearchPanel 的 "⭐ 沉淀" → 弹这个 modal 填表 →
// POST /__sync/network-pool → vite plugin 写盘 → HMR reload → 新素材进 ALL_PANDAS/ALL_FACES
//
// 沉淀完成后 toast 提示 "建议立即校准 face 锚点" + 一键跳 /?page=calibrate

import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchAsBlob, blobToBase64, proxyImageUrl, type NetworkResult } from '@/lib/networkImage';
import { useMeme } from '@/context/memecontext';

export interface PandaSearchSaveModalProps {
  result: NetworkResult | null;
  onClose: () => void;
  onSaved: (kind: 'panda' | 'face' | 'scene', id: string) => void;
  lang: 'zh' | 'en';
}

function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h = h | 0;
  }
  return Math.abs(h).toString(36).slice(0, 8);
}

function makeId(kind: 'panda' | 'face' | 'scene', src: string): string {
  return `network-${kind}-${djb2Hash(src + Date.now().toString())}`;
}

export function PandaSearchSaveModal(props: PandaSearchSaveModalProps) {
  // DEV gate — prod 完全不挂载
  if (!import.meta.env.DEV) return null;

  const { result, onClose, onSaved, lang } = props;
  const { t } = useMeme();

  const [kind, setKind] = useState<'panda' | 'face' | 'scene'>('face');
  const [labelCn, setLabelCn] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  // 取消时 abort 任何 in-flight fetch, 避免 modal 关了但请求还在跑
  const abortRef = useRef<AbortController | null>(null);

  // result 变化 (新弹一个 modal) 时 reset 所有内部 state
  useEffect(() => {
    setKind('face');
    setLabelCn('');
    setLabelEn('');
    setTags('');
    setSaving(false);
  }, [result?.id]);

  // unmount 时 abort
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const id = useMemo(
    () => (result ? makeId(kind, result.src) : ''),
    [kind, result],
  );

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSaving(false);
    onClose();
  }, [onClose]);

  if (!result) return null;

  const handleSubmit = async () => {
    if (!labelCn.trim()) {
      toast.error(lang === 'zh' ? '请填中文名' : 'Chinese name required');
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSaving(true);
    try {
      const blob = await fetchAsBlob(result.src, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const blobBase64 = await blobToBase64(blob);
      if (ctrl.signal.aborted) return;
      const tagList = tags
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);

      const res = await fetch('/__sync/network-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          kind,
          labelCn: labelCn.trim(),
          labelEn: labelEn.trim() || labelCn.trim(),
          tags: tagList,
          tagsEn: tagList,
          sourceUrl: result.src,
          blobBase64,
        }),
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
      }
      const data = (await res.json()) as { ok: boolean; id: string };
      if (!data.ok) throw new Error('sync returned not ok');
      onSaved(kind, data.id);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const msg = (e as Error).message ?? 'unknown';
      // eslint-disable-next-line no-console
      console.error('[SaveModal] submit failed', e);
      toast.error(`${t('networkSearchError')}: ${msg}`);
    } finally {
      if (!ctrl.signal.aborted) setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 14,
          maxWidth: 480, width: '100%',
          padding: 20, boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
          maxHeight: '90vh', overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0a356d' }}>
            {t('networkSearchSaveModalTitle')}
          </h3>
          <button
            onClick={handleClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
            type="button"
            disabled={saving}
            aria-label="close"
          >
            <X size={16} />
          </button>
        </div>

        {/* 预览 */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <img
            src={proxyImageUrl(result.thumb || result.src)}
            alt=""
            style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid #ddd', background: '#fafafa' }}
            draggable={false}
          />
        </div>

        {/* kind */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
            {t('networkSearchSaveModalKind')}
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['panda', 'face', 'scene'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: kind === k ? '2px solid #FF5E00' : '1px solid #ddd',
                  background: kind === k ? '#fff5ee' : '#fff',
                  color: kind === k ? '#FF5E00' : '#333',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {k === 'panda'
                  ? t('networkSearchSaveModalKindPanda')
                  : k === 'face'
                    ? t('networkSearchSaveModalKindFace')
                    : t('networkSearchSaveModalKindScene')}
              </button>
            ))}
          </div>
        </div>

        {/* labelCn */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
            {t('networkSearchSaveModalLabel')} ({lang === 'zh' ? '中文 *' : 'CN *'})
          </label>
          <input
            type="text"
            value={labelCn}
            onChange={(e) => setLabelCn(e.target.value)}
            placeholder={result.hint || (lang === 'zh' ? '例: 馆长狂喜' : 'e.g. Crazy Joy')}
            disabled={saving}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 6,
              border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box',
            }}
            maxLength={20}
          />
        </div>

        {/* labelEn */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
            {t('networkSearchSaveModalLabel')} ({lang === 'zh' ? '英文' : 'EN'})
          </label>
          <input
            type="text"
            value={labelEn}
            onChange={(e) => setLabelEn(e.target.value)}
            placeholder={lang === 'zh' ? '留空则用中文' : 'fallback to CN'}
            disabled={saving}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 6,
              border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box',
            }}
            maxLength={20}
          />
        </div>

        {/* tags */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
            {t('networkSearchSaveModalTags')}
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={lang === 'zh' ? '开心, 大笑, 表情' : 'happy, laugh'}
            disabled={saving}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 6,
              border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box',
            }}
          />
        </div>

        {/* id preview */}
        <div style={{ fontSize: 10, color: '#999', marginBottom: 14, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
          id: <code>{id}</code>
        </div>

        {/* actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={handleClose}
            disabled={saving}
            type="button"
            style={{
              padding: '8px 14px', borderRadius: 6,
              border: '1px solid #ddd', background: '#fff',
              cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13,
            }}
          >
            {t('cancel')}
          </button>
          <button
            onClick={() => { void handleSubmit(); }}
            disabled={saving || !labelCn.trim()}
            type="button"
            style={{
              padding: '8px 14px', borderRadius: 6, border: 'none',
              background: '#FF5E00', color: '#fff',
              cursor: saving || !labelCn.trim() ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600,
              opacity: saving || !labelCn.trim() ? 0.5 : 1,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            {saving ? <Loader2 size={12} className="psp-spinner" /> : null}
            {saving ? '...' : t('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
