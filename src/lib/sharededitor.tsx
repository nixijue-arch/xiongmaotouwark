/* eslint-disable react-refresh/only-export-components -- 刻意: 共享模块同时导出组件 + 工具/常量 (video+gif 复用), 非纯组件文件 */
// sharededitor.tsx — 沙雕动画 视频/GIF 共享编辑组件 + 基础类型 (extract-then-import)
// 融会贯通但不打通: video(animatemode) 与 gif(gifmode) 都 import 这里; 项目数据各自独立.
// 红线: 只 import 叶子模块 (animcore / composeMeme / data / memecontext), 绝不 import
//        animatemode / gifmode (animate 已 import gifmode, 反向会成环)。
// 组件靠 DragPayload 回调解耦: video 传 timeline 语义回调; gif 传全幅 [0,D] 回调。

import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { Shuffle, Search, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { composeMeme, flattenAlphaShell } from '@/lib/composeMeme';
import { ALL_PANDAS, ALL_FACES, getLivePandaFaceOffset, type Material } from '@/data/materials';
import type { DraftSlot, ImageElement, TextElement } from '@/context/memecontext';
import type { TrackType, ImageFx, CaptionStyle, Clip } from '@/lib/animcore';
import { pickRandomText, type Mode as CaptionMode, MODE_LABELS as CAPTION_MODE_LABELS } from '@/data/quickModeTexts';
import { VOICE_LIB, resolveVoiceId, estimateTTSDuration } from '@/lib/voicelib';
import { PandaSearchModal } from '@/components/pandasearchmodal';
import { SmartExtractModal } from '@/components/smartextractmodal';

// 拖拽 / 快速添加 的数据载体 — 组件只 emit 它, 由各 host 自行建 clip
// (video = timeline 语义 playhead+找空位; gif = 全幅 [0,duration])。这是抽取的接缝。
export interface DragPayload {
  type: TrackType;
  src?: string; label?: string;
  voice?: string; text?: string;
  bgmId?: string; name?: string;
  fx?: ImageFx;
  // image 子类 — 'scene' = 场景背景图 (全屏 cover)
  kind?: 'scene';
  // caption 模板
  captionStyle?: CaptionStyle;
  captionFontSize?: number;
  captionColor?: string;
  captionTransform?: { x: number; y: number }; // 位置预设用 (video host 忽略, gif host 应用)
  defaultDuration?: number;
}

// 统一 id 生成器 (video + 共享组件用; gifmode 有自己的本地同名实现)
export function uid(prefix = 'c') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ============================================================
// 场景库 — 实拍位图 (Lorem Picsum stable seed, fastly CDN 全球, CORS open)
// img.crossOrigin='anonymous' 已 set, 可用于 canvas 合成 + MP4 export
// 同 seed 永远同图. 1280x720 = sl1 cover ratio.
// 加载失败时 onerror 占位 — fallback 引导用户去外部图源 (unsplash/pixabay/pexels) 上传
// ============================================================
export const PICSUM = (seed: string) => `https://picsum.photos/seed/${seed}/1280/720`;
export const SCENE_LIB: Material[] = [
  { id: 'scene-city',    src: PICSUM('city18'),     labelCn: '城市',     labelEn: 'City',     tags: ['场景', '城市', '街道'], tagsEn: ['scene', 'city'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-mountain', src: PICSUM('mountain7'), labelCn: '山林',     labelEn: 'Mountain', tags: ['场景', '山', '自然'],   tagsEn: ['scene', 'mountain'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-beach',   src: PICSUM('beach22'),   labelCn: '海滩',     labelEn: 'Beach',    tags: ['场景', '海', '海滩'],   tagsEn: ['scene', 'beach'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-forest',  src: PICSUM('forest11'),  labelCn: '森林',     labelEn: 'Forest',   tags: ['场景', '森林', '树'],   tagsEn: ['scene', 'forest'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-room',    src: PICSUM('room33'),    labelCn: '房间',     labelEn: 'Room',     tags: ['场景', '室内', '房间'], tagsEn: ['scene', 'room'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-street',  src: PICSUM('street55'),  labelCn: '街道',     labelEn: 'Street',   tags: ['场景', '街道', '都市'], tagsEn: ['scene', 'street'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-sky',     src: PICSUM('sky88'),     labelCn: '天空',     labelEn: 'Sky',      tags: ['场景', '天空', '云'],   tagsEn: ['scene', 'sky'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-sunset',  src: PICSUM('sunset44'),  labelCn: '日落',     labelEn: 'Sunset',   tags: ['场景', '日落', '黄昏'], tagsEn: ['scene', 'sunset'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-night',   src: PICSUM('night77'),   labelCn: '夜景',     labelEn: 'Night',    tags: ['场景', '夜', '霓虹'],   tagsEn: ['scene', 'night'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-snow',    src: PICSUM('snow99'),    labelCn: '雪景',     labelEn: 'Snow',     tags: ['场景', '雪', '冬'],     tagsEn: ['scene', 'snow'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-desert',  src: PICSUM('desert12'),  labelCn: '沙漠',     labelEn: 'Desert',   tags: ['场景', '沙漠'],         tagsEn: ['scene', 'desert'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
  { id: 'scene-cafe',    src: PICSUM('cafe66'),    labelCn: '咖啡馆',   labelEn: 'Cafe',     tags: ['场景', '咖啡馆', '室内'], tagsEn: ['scene', 'cafe'], faceOffset: { x: 0, y: 0, w: 0, h: 0 }, kind: 'scene' },
];

// ============================================================
// 配套合成 — panda + face. video: onAdd 单合成图; gif: onAddCombo 拆两图层 (host 处理)
// ============================================================
export function ComboTab({ onAdd, onAddCombo }: {
  onAdd: (payload: DragPayload) => void;
  onAddCombo?: (panda: Material, face: Material) => void; // GIF: 拆两个独立图层 (host 自己算 face 位置)
}) {
  const [pIdx, setPIdx] = useState(() => Math.floor(Math.random() * ALL_PANDAS.length));
  const [fIdx, setFIdx] = useState(() => Math.floor(Math.random() * ALL_FACES.length));
  const [comboLayers, setComboLayers] = useState<'one' | 'two'>('two'); // GIF: 双层(各自动) / 单层(整体). video 永远单层
  const [picker, setPicker] = useState<'panda' | 'face' | null>(null);
  const [pickerQ, setPickerQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string>('');
  const panda = ALL_PANDAS[pIdx % ALL_PANDAS.length];
  const face = ALL_FACES[fIdx % ALL_FACES.length];

  useEffect(() => {
    let cancelled = false;
    setPreview('');
    // 直接生成 dataURL — preview 用 + 拖到时间轴当 clip src 都能持久化
    void composeMeme({
      pandaSrc: panda.src, faceSrc: face.src,
      faceOffset: getLivePandaFaceOffset(panda),
      size: 384, outputFormat: 'dataurl',
      fillInternalShell: true,
    }).then(url => {
      if (!cancelled) setPreview(url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [panda.src, face.src, panda]);

  const shuffle = () => {
    setPIdx(Math.floor(Math.random() * ALL_PANDAS.length));
    setFIdx(Math.floor(Math.random() * ALL_FACES.length));
  };
  const cyclePanda = (dir: 1 | -1) => setPIdx(i => (i + dir + ALL_PANDAS.length) % ALL_PANDAS.length);
  const cycleFace = (dir: 1 | -1) => setFIdx(i => (i + dir + ALL_FACES.length) % ALL_FACES.length);

  const handleAdd = async () => {
    if (loading) return;
    // GIF 双层: 拆两图层 — host 用 panda.faceOffset 算 face 位置, 各自可套循环动作
    if (onAddCombo && comboLayers === 'two') { onAddCombo(panda, face); return; }
    // 单层 (video 永远走这 / GIF 选"单层"): 合成一张图层
    setLoading(true);
    try {
      // 加 ImageClip 必须用 dataURL 持久化 (blob URL 刷新失效 → 破图)
      const composed = await composeMeme({
        pandaSrc: panda.src, faceSrc: face.src,
        faceOffset: getLivePandaFaceOffset(panda),
        size: 384, outputFormat: 'dataurl',
        fillInternalShell: true,
      });
      onAdd({ type: 'image', src: composed, label: `${panda.labelCn}+${face.labelCn}`, defaultDuration: 2.5 });
      toast.success(`已加 ${panda.labelCn}+${face.labelCn} 配套`);
    } catch {
      toast.error('合成失败');
    } finally {
      setLoading(false);
    }
  };

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (!preview) { e.preventDefault(); return; }
    const payload: DragPayload = { type: 'image', src: preview, label: `${panda.labelCn}+${face.labelCn}`, defaultDuration: 2.5 };
    e.dataTransfer.setData('application/x-meme', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  // 展开 picker — 列出全部 panda 或 face, 支持搜索
  const pickerList = useMemo(() => {
    if (!picker) return [] as Material[];
    const all = picker === 'panda' ? ALL_PANDAS : ALL_FACES;
    if (!pickerQ) return all;
    const k = pickerQ.toLowerCase();
    return all.filter(m =>
      m.labelCn.toLowerCase().includes(k) ||
      m.labelEn.toLowerCase().includes(k) ||
      m.tags.some(t => t.toLowerCase().includes(k))
    );
  }, [picker, pickerQ]);

  return (
    <div className="am-combo-tab">
      <div className="am-combo-tab-head">
        <span className="am-combo-tab-title">🐼+🤔 配套合成</span>
        <span className="am-combo-tab-sub">{onAddCombo ? (comboLayers === 'two' ? '双图层 · 可分别套动作' : '单图层 · 整体一起动') : '校准自动应用 · 单层加入'}</span>
      </div>

      <div className="am-combo-tab-slots">
        <div className="am-combo-tab-slot">
          <div className="am-combo-tab-slot-label">熊猫头 ({pIdx + 1}/{ALL_PANDAS.length})</div>
          <div className="am-combo-tab-slot-row">
            <button className="am-combo-arrow" onClick={() => cyclePanda(-1)} type="button" title="上一个">‹</button>
            <button
              className="am-combo-tab-thumb-btn"
              onClick={() => { setPicker('panda'); setPickerQ(''); }}
              title="点击展开全部选项手动选"
              type="button"
            >
              <img src={panda.src} alt={panda.labelCn} className="am-combo-tab-thumb" draggable={false} />
              <span className="am-combo-tab-thumb-name">{panda.labelCn}</span>
              <span className="am-combo-tab-expand">▾</span>
            </button>
            <button className="am-combo-arrow" onClick={() => cyclePanda(1)} type="button" title="下一个">›</button>
          </div>
        </div>

        <div className="am-combo-tab-slot">
          <div className="am-combo-tab-slot-label">表情 ({fIdx + 1}/{ALL_FACES.length})</div>
          <div className="am-combo-tab-slot-row">
            <button className="am-combo-arrow" onClick={() => cycleFace(-1)} type="button" title="上一个">‹</button>
            <button
              className="am-combo-tab-thumb-btn"
              onClick={() => { setPicker('face'); setPickerQ(''); }}
              title="点击展开全部选项手动选"
              type="button"
            >
              <img src={face.src} alt={face.labelCn} className="am-combo-tab-thumb" draggable={false} />
              <span className="am-combo-tab-thumb-name">{face.labelCn}</span>
              <span className="am-combo-tab-expand">▾</span>
            </button>
            <button className="am-combo-arrow" onClick={() => cycleFace(1)} type="button" title="下一个">›</button>
          </div>
        </div>
      </div>

      <button className="am-combo-shuffle-btn" onClick={shuffle} type="button">
        <Shuffle size={12} /> <span>随机一对</span>
      </button>

      <div
        className="am-combo-tab-preview"
        draggable={!!preview}
        onDragStart={onDragStart}
        title={preview ? '点 / 拖拽 加入' : '合成中…'}
      >
        {preview ? (
          <img src={preview} alt="合成预览" className="am-combo-tab-preview-img" draggable={false} />
        ) : (
          <div className="am-combo-preview-loading">合成中…</div>
        )}
      </div>
      {onAddCombo && (
        <div className="am-combo-layers">
          <button type="button" className={'am-combo-layer-btn' + (comboLayers === 'two' ? ' is-active' : '')} onClick={() => setComboLayers('two')} title="熊猫 + 脸 拆成两图层, 各自可套不同循环动作 (脸动身体不动 等)">双层 · 可分别动</button>
          <button type="button" className={'am-combo-layer-btn' + (comboLayers === 'one' ? ' is-active' : '')} onClick={() => setComboLayers('one')} title="合成一张图层, 整体一起动 (简单稳)">单层 · 整体</button>
        </div>
      )}
      <button className="am-combo-add" onClick={handleAdd} disabled={loading || !preview} type="button">
        {loading ? '加入中…' : (onAddCombo ? (comboLayers === 'two' ? '✚ 加入 · 双层' : '✚ 加入 · 单层') : '✚ 加入时间轴')}
      </button>

      {picker && (
        <div className="am-combo-picker-overlay" onClick={() => setPicker(null)}>
          <div className="am-combo-picker win7-panel" onClick={(e) => e.stopPropagation()}>
            <div className="am-combo-picker-head">
              <span>选 {picker === 'panda' ? '熊猫头' : '表情'} · {pickerList.length}/{picker === 'panda' ? ALL_PANDAS.length : ALL_FACES.length}</span>
              <button className="am-popover-close" onClick={() => setPicker(null)} type="button"><X size={14} /></button>
            </div>
            <div className="am-combo-picker-search material-search-box">
              <Search size={12} color="#888" />
              <input
                autoFocus
                type="text"
                className="material-search-input"
                placeholder={`搜${picker === 'panda' ? '熊猫头' : '表情'}…`}
                value={pickerQ}
                onChange={(e) => setPickerQ(e.target.value)}
              />
              {pickerQ && (
                <button className="material-search-clear" onClick={() => setPickerQ('')} type="button">
                  <X size={11} />
                </button>
              )}
            </div>
            <div className="am-combo-picker-grid">
              {pickerList.map((m) => {
                const origIdx = (picker === 'panda' ? ALL_PANDAS : ALL_FACES).findIndex(x => x.id === m.id);
                const isActive = picker === 'panda' ? origIdx === pIdx : origIdx === fIdx;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={'am-combo-picker-card' + (isActive ? ' is-active' : '')}
                    onClick={() => {
                      if (picker === 'panda') setPIdx(origIdx);
                      else setFIdx(origIdx);
                      setPicker(null);
                    }}
                    title={m.labelCn}
                  >
                    <img src={m.src} alt={m.labelCn} className="am-combo-picker-thumb" draggable={false} loading="lazy" />
                    <span className="am-combo-picker-name">{m.labelCn}</span>
                  </button>
                );
              })}
              {pickerList.length === 0 && (
                <div className="am-combo-picker-empty">无匹配 · 改关键词试试</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 素材卡片 — panda/face/scene/upload 单击或拖入. onQuickAdd emit DragPayload, host 建 clip
// ============================================================
// 联网搜图 / 智能抠脸 入口 — video + gif 素材面板复用 (小按钮 → 弹既有 modal → 结果落进对应素材池)
// kind='panda' → 联网搜图 (整张熊猫头, 落 kind=panda); kind='face' → 智能抠脸 (MediaPipe, 落 kind=face)
// 复用编辑器/快速已有的 PandaSearchModal / SmartExtractModal, 不重写
export function MaterialSourceButtons({ kind, onAdd }: { kind: 'panda' | 'face'; onAdd: (m: Material) => void }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  return (
    <div className="am-matsrc">
      {kind === 'panda' ? (
        <button type="button" className="am-tb-btn am-matsrc-btn" onClick={() => setSearchOpen(true)} title="联网搜熊猫头表情包, 选中加入熊猫池">
          <Search size={13} strokeWidth={2.2} /> 联网搜图
        </button>
      ) : (
        <button type="button" className="am-tb-btn am-matsrc-btn" onClick={() => setExtractOpen(true)} title="上传照片智能抠出人脸, 加入表情池">
          <Sparkles size={13} strokeWidth={2.2} /> 智能抠脸
        </button>
      )}
      {searchOpen && (
        <PandaSearchModal
          open lang="zh"
          onClose={() => setSearchOpen(false)}
          onSelect={(mat) => { onAdd({ ...mat, kind: 'panda' }); setSearchOpen(false); toast.success(`已加入熊猫池: ${mat.labelCn}`); }}
        />
      )}
      {extractOpen && (
        <SmartExtractModal
          isOpen language="zh"
          onClose={() => setExtractOpen(false)}
          onConfirm={(dataUrl) => {
            onAdd({ id: `custom-face-${uid('cf')}`, src: dataUrl, labelCn: '抠脸', labelEn: 'Face', tags: ['抠脸'], tagsEn: ['face'], faceOffset: { x: 100, y: 70, w: 250, h: 250 }, kind: 'face' });
            setExtractOpen(false); toast.success('已加入表情池');
          }}
        />
      )}
    </div>
  );
}

// memo: 播放时 LeftPane 每帧重渲, ~200 张素材卡只要 props (item/kind/onQuickAdd) 不变就跳过重渲.
// 关键: onQuickAdd 必须稳定 (animatemode quickAdd 已去掉 playhead dep). video+gif 共享受益.
export const MaterialCardClip = memo(MaterialCardClipImpl);
function MaterialCardClipImpl({ item, kind, onQuickAdd, onDelete }: {
  item: Material; kind?: 'scene' | 'panda' | 'face' | 'upload';
  onQuickAdd: (payload: DragPayload) => void;
  onDelete?: () => void;
}) {
  // 单独 panda/face 拖入沙雕动画时, flattenAlphaShell 把内部 transparent fill 白, 防场景透出
  // scene 不处理 (本身就是背景), upload 用户图也不动 (尊重用户原图)
  const needsFlattenShell = kind === 'panda' || kind === 'face';
  const buildPayload = useCallback(async (): Promise<DragPayload> => {
    let src = item.src;
    if (needsFlattenShell) {
      try { src = await flattenAlphaShell(item.src); } catch { /* fallback 原 src */ }
    }
    return {
      type: 'image', src, label: item.labelCn,
      defaultDuration: kind === 'scene' ? 4.0 : 2.5,
      kind: kind === 'scene' ? 'scene' : undefined,
    };
  }, [item.src, item.labelCn, kind, needsFlattenShell]);
  // v23-i: 性能修 — 之前 mount 时所有 ~200 panda/face card 并发跑 flattenAlphaShell, 卡板. 改 lazy
  // cached 默认拿原 src (拖时立即可用, panda 内部边缘可能透出, trade-off)
  // hover/click 才触发 flatten, cache 命中后下次 fast
  const cachedPayloadRef = useRef<DragPayload | null>(null);
  useEffect(() => {
    cachedPayloadRef.current = {
      type: 'image', src: item.src, label: item.labelCn,
      defaultDuration: kind === 'scene' ? 4.0 : 2.5,
      kind: kind === 'scene' ? 'scene' as const : undefined,
    };
  }, [item.src, item.labelCn, kind]);
  // hover warmup — 用户 hover 1 张卡时才 schedule flatten (一次性 1 个并发, 不卡 LeftPane)
  const warmedRef = useRef(false);
  const onHover = () => {
    if (!needsFlattenShell || warmedRef.current) return;
    warmedRef.current = true;
    void buildPayload().then(p => { cachedPayloadRef.current = p; }).catch(() => {});
  };
  const handleClick = useCallback(async () => {
    const tid = needsFlattenShell ? toast.loading('合成中…') : null;
    try {
      const payload = await buildPayload();
      if (tid) toast.dismiss(tid);
      onQuickAdd(payload);
    } catch (e) {
      if (tid) toast.dismiss(tid);
      toast.error('处理失败: ' + (e as Error).message);
    }
  }, [buildPayload, needsFlattenShell, onQuickAdd]);
  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const p = cachedPayloadRef.current ?? {
      type: 'image' as const, src: item.src, label: item.labelCn,
      defaultDuration: kind === 'scene' ? 4.0 : 2.5,
      kind: kind === 'scene' ? 'scene' as const : undefined,
    };
    e.dataTransfer.setData('application/x-meme', JSON.stringify(p));
    e.dataTransfer.effectAllowed = 'copy';
    const imgEl = e.currentTarget.querySelector('img') as HTMLImageElement | null;
    if (imgEl) { try { e.dataTransfer.setDragImage(imgEl, 32, 32); } catch { /* setDragImage 失败忽略 */ } }
  };
  return (
    <div
      className="material-card am-card"
      draggable
      onDragStart={onDragStart}
      onClick={handleClick}
      onDoubleClick={handleClick}
      onMouseEnter={onHover}
      title={`单击或拖到时间轴: ${item.labelCn}`}
    >
      <img
        src={item.src}
        alt={item.labelCn}
        className={'material-img' + (kind === 'scene' ? ' am-img-scene' : '')}
        draggable={false}
        loading="lazy"
        onError={(e) => {
          // Picsum 偶发 5xx / 国内偶尔被墙 → 显占位 + 提示用户改用外部图源上传
          const el = e.currentTarget;
          el.style.background = 'linear-gradient(135deg, #cbd1da, #8b95a4)';
          el.style.objectFit = 'contain';
          el.removeAttribute('src');
        }}
      />
      <span className="material-name">{item.labelCn}</span>
      {item.tags.length > 0 && kind !== 'scene' && (
        <div className="material-tags">
          {item.tags.slice(0, 2).map(t => <span key={t} className="material-tag">{t}</span>)}
        </div>
      )}
      {onDelete && (
        <button className="am-card-del" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="删除">
          <X size={10} />
        </button>
      )}
    </div>
  );
}

// ============================================================
// 草图卡片 — 共享 meme 草稿池 (xiongmaotou.editor-drafts) 的一格. 点击 → onAddDraftAsClips
// ============================================================
export function DraftCardClip({ slot, onAddDraftAsClips }: {
  slot: DraftSlot;
  onAddDraftAsClips: (s: DraftSlot) => void;
}) {
  const { previewUrl, name, elementCount } = slot;
  // 检测是否有文字 — 用于给 card 加 "字幕分轨" tag
  const hasText = useMemo(() => {
    return (slot.state?.elements ?? []).some(e => e.type === 'text' && !!(e as TextElement).text?.trim());
  }, [slot.state]);
  return (
    <div
      className="material-card am-card am-card-draft"
      onClick={() => onAddDraftAsClips(slot)}
      onDoubleClick={() => onAddDraftAsClips(slot)}
      title={`点击加入: ${name} — 画面 + 字幕 自动分轨`}
    >
      {previewUrl ? (
        <img src={previewUrl} alt={name} className="material-img am-img-draft" draggable={false} loading="lazy" />
      ) : (
        <div className="material-img am-draft-blank">—</div>
      )}
      <span className="material-name">{name}</span>
      <div className="material-tags">
        <span className="material-tag">{elementCount} 层</span>
        {hasText && <span className="material-tag am-draft-tag-cap">字幕分轨</span>}
      </div>
    </div>
  );
}

// ============================================================
// draftToLayers — 把一个 meme 草稿 slot 解析成 { imgSrc, label, text } (纯函数, 无 timeline)
// video(addDraftAsClips) 与 gif 都用: 各自再按自己的方式建 clip (timeline / 全幅)
// 优先级: panda+face → composeMeme 合成无字幕高清图; panda 整图 → 直接用; fallback → previewUrl
// ============================================================
export async function draftToLayers(slot: DraftSlot): Promise<{ imgSrc: string; label: string; text?: string }> {
  const elements = slot.state?.elements ?? [];
  const isPandaName = (n: string | undefined) => !!n && (
    ALL_PANDAS.some(p => p.id === n)
    || n.startsWith('upload-panda-')
    || n.startsWith('network-panda-')
    || n.startsWith('custom-panda-')
    || n === 'panda-head'   // handleAddFace 兜底命名 (跟 leftsidebar/collection 一致, 防草稿整图缩略图化)
  );
  const isFaceName = (n: string | undefined) => !!n && (
    ALL_FACES.some(f => f.id === n)
    || n.startsWith('upload-face-')
    || n.startsWith('custom-face-')
    || n.startsWith('network-face-')
  );
  const pandaEl = elements.find((e): e is ImageElement => e.type === 'image' && isPandaName((e as ImageElement).name));
  const faceEl = elements.find((e): e is ImageElement => e.type === 'image' && isFaceName((e as ImageElement).name));
  const textEl = elements.find((e): e is TextElement => e.type === 'text');

  let imgSrc = slot.previewUrl;
  if (pandaEl && faceEl) {
    // 内置 panda 查 meta 拿 faceOffset; 非内置 panda 用整图 fallback (避免硬编码 faceOffset 合成丑)
    const pandaMeta = ALL_PANDAS.find(p => p.id === pandaEl.name);
    if (pandaMeta) {
      try {
        imgSrc = await composeMeme({
          pandaSrc: pandaMeta.src,
          faceSrc: faceEl.src,
          faceOffset: getLivePandaFaceOffset(pandaMeta),
          size: 384, outputFormat: 'dataurl',
          fillInternalShell: true,
        });
      } catch { /* 落败用 previewUrl */ }
    } else {
      // 非内置 panda (upload/network/custom) + face: 整图 fallback
      imgSrc = pandaEl.src;
    }
  } else if (pandaEl && !faceEl) {
    // 整图模式 — panda 自身就是完整作品 (网图 / 上传整图 / 自制整图)
    imgSrc = pandaEl.src;
  }

  return { imgSrc, label: slot.name || '草图', text: textEl?.text?.trim() || undefined };
}

// ============================================================
// 字幕工具 (video + gif 共用) — 快速生成 / 位置预设 / 表情 / 批量导入
// 全部 emit DragPayload(type:'caption') 或 Clip[]; host 自行建 clip (timeline / 全幅)
// ============================================================
const CAPTION_SAMPLE_TEXT = '字幕样式';

// 字幕快速生成 — 从 quickModeTexts 随机出文字 + 用户调样式 → 拖/单击加
export function CaptionQuickGen({ onQuickAdd }: { onQuickAdd: (p: DragPayload) => void }) {
  const [mode, setMode] = useState<CaptionMode | 'all'>('all');
  const [text, setText] = useState(() => pickRandomText('zh', 'all') || '点击编辑字幕');
  const [style, setStyle] = useState<CaptionStyle>('meme');
  const [fontSize, setFontSize] = useState(56);
  const [color, setColor] = useState('#ffffff');
  const reroll = useCallback(() => {
    const t = pickRandomText('zh', mode, text);
    if (t) setText(t);
  }, [mode, text]);
  const payload: DragPayload = useMemo(() => ({
    type: 'caption',
    text,
    captionStyle: style,
    captionFontSize: fontSize,
    captionColor: color,
    defaultDuration: 2.5,
  }), [text, style, fontSize, color]);
  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/x-meme', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };
  const MODE_BTNS: (CaptionMode | 'all')[] = ['all', 'roast', 'fomo', 'fud'];
  return (
    <div className="am-cap-quick win7-panel">
      <div className="am-cap-quick-head">
        <span>🎲 快速生成</span>
        <span className="am-cap-quick-sub">从快速模式池抽 · 编辑后加</span>
      </div>
      <div className="am-cap-quick-modes">
        {MODE_BTNS.map(m => (
          <button
            key={m}
            type="button"
            className={'am-cap-quick-mode' + (mode === m ? ' is-active' : '')}
            onClick={() => { setMode(m); const t = pickRandomText('zh', m); if (t) setText(t); }}
            title={m === 'all' ? '默认 (全池)' : CAPTION_MODE_LABELS[m]?.zh ?? m}
          >
            {m === 'all' ? '默认' : CAPTION_MODE_LABELS[m]?.zh ?? m}
          </button>
        ))}
      </div>
      <div
        className={`am-cap-quick-preview am-caption-style-${style} am-cap-preview-demo`}
        draggable
        onDragStart={onDragStart}
        style={{
          fontSize: Math.max(18, Math.min(64, fontSize * 0.7)),
          color,
          minHeight: Math.max(60, fontSize * 0.95),
        }}
        title={`样式演示 · 加时实际文字: "${text || '空'}" · 字号 ${fontSize}px`}
      >
        {CAPTION_SAMPLE_TEXT}
      </div>
      <div className="am-row am-row-tight" style={{ marginTop: 6 }}>
        <button type="button" className="am-tb-btn" onClick={reroll} title="再抽一条 (避免连出同句)">
          <Shuffle size={11} /> 换一条
        </button>
        <input
          type="text"
          className="am-input am-cap-quick-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="或直接打字"
          maxLength={80}
        />
      </div>
      <div className="am-cap-quick-row">
        <span className="am-cap-quick-label">样式</span>
        <div className="am-style-chips am-style-chips-mini">
          {(['meme', 'panel', 'bar'] as CaptionStyle[]).map(s => (
            <button
              key={s}
              type="button"
              className={`am-style-chip am-style-chip-${s}${style === s ? ' is-active' : ''}`}
              onClick={() => {
                setStyle(s);
                if (s === 'panel' && color === '#ffffff') setColor('#222222');
                if (s !== 'panel' && color === '#222222') setColor('#ffffff');
              }}
            >
              {s === 'meme' ? 'Meme' : s === 'panel' ? '白板' : '黑条'}
            </button>
          ))}
        </div>
      </div>
      <div className="am-cap-quick-row">
        <span className="am-cap-quick-label">字号</span>
        <input
          type="range" min="20" max="100" step="2"
          value={fontSize}
          onChange={(e) => setFontSize(parseInt(e.target.value))}
          className="am-range am-cap-quick-range"
        />
        <span className="am-cap-quick-val">{fontSize}</span>
      </div>
      <div className="am-cap-quick-row">
        <span className="am-cap-quick-label">颜色</span>
        <div className="am-chips am-chips-tight">
          {['#ffffff', '#222222', '#ff5e00', '#1f84df', '#00cc66', '#cb2a2a', '#ffbf22'].map(c => (
            <button
              key={c}
              type="button"
              className={'am-chip am-chip-color' + (color.toLowerCase() === c.toLowerCase() ? ' is-active' : '')}
              style={{ background: c, width: 18, height: 18, padding: 0 }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        className="am-tb-btn am-tb-btn-primary am-cap-quick-add"
        onClick={() => onQuickAdd(payload)}
      >
        ✚ 加字幕
      </button>
    </div>
  );
}

// 字幕位置预设 — 5 个常用位置. captionTransform 真正定位 (gif host 应用; video host 忽略, 同旧行为)
export function CaptionPositionPresets({ onQuickAdd }: { onQuickAdd: (p: DragPayload) => void }) {
  const presets: { id: string; label: string; x: number; y: number; emoji: string }[] = [
    { id: 'top',       label: '顶部',   x: 0,  y: -35, emoji: '⬆️' },
    { id: 'mid-up',    label: '中上',   x: 0,  y: -15, emoji: '↗' },
    { id: 'mid',       label: '居中',   x: 0,  y: 0,   emoji: '·' },
    { id: 'mid-down',  label: '中下',   x: 0,  y: 15,  emoji: '↘' },
    { id: 'bottom',    label: '底部',   x: 0,  y: 35,  emoji: '⬇️' },
  ];
  const addAt = (p: typeof presets[number]) => {
    onQuickAdd({
      type: 'caption', text: '位置示例', captionStyle: 'meme', captionFontSize: 48,
      defaultDuration: 2.5, captionTransform: { x: p.x, y: p.y },
    });
    toast(`已加字幕 · ${p.label}`, { duration: 2000 });
  };
  return (
    <div className="am-cap-extra-card">
      <div className="am-cap-extra-head">📍 字幕位置预设</div>
      <div className="am-cap-extra-sub">点一下加位置示例 · 加入后可继续拖</div>
      <div className="am-cap-pos-grid">
        {presets.map(p => (
          <button key={p.id} type="button" className="am-cap-pos-btn" onClick={() => addAt(p)} title={`y=${p.y}%`}>
            <span className="am-cap-pos-icon">{p.emoji}</span>
            <span className="am-cap-pos-label">{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// 沙雕常用 emoji 一键插入 — 单 emoji 字幕, 大字号
export function CaptionEmojiPicker({ onQuickAdd }: { onQuickAdd: (p: DragPayload) => void }) {
  const emojis = ['😂', '🤣', '💀', '🐼', '🤡', '🥹', '🫠', '😭', '👀', '👻', '💩', '🔥', '✨', '💯', '🙏', '🤝'];
  return (
    <div className="am-cap-extra-card">
      <div className="am-cap-extra-head">🎭 沙雕表情字幕</div>
      <div className="am-cap-extra-sub">单击加一条单 emoji 字幕 · 大字号</div>
      <div className="am-cap-emoji-grid">
        {emojis.map(e => (
          <button
            key={e}
            type="button"
            className="am-cap-emoji-btn"
            onClick={() => onQuickAdd({ type: 'caption', text: e, captionStyle: 'meme', captionFontSize: 80, defaultDuration: 1.2 })}
            title={`加 ${e} 字幕 (大字号 1.2s)`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

// 批量字幕导入 — paste 多行 → 按行 split. video: 可选配 TTS; gif: isGif=true 强制仅字幕 (无声)
export function CaptionBatchImport({ onQuickAdd, onAddClipsBatch, playhead, projectDuration, isGif }: {
  onQuickAdd: (p: DragPayload) => void;
  onAddClipsBatch: (clips: Clip[]) => void;
  playhead: number;
  projectDuration: number;
  isGif?: boolean;
}) {
  const [text, setText] = useState('');
  const [withTTS, setWithTTS] = useState(!isGif);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const effWithTTS = !isGif && withTTS;
  const doImport = () => {
    if (lines.length === 0) { toast.error('粘贴一段台词, 每行一条字幕'); return; }
    if (effWithTTS) {
      const voice = VOICE_LIB[0].id;
      const ttsVoice = resolveVoiceId(voice);
      const clips: Clip[] = [];
      let cursor = Math.max(0, playhead);
      const gap = 0.3;
      for (const line of lines) {
        const dur = estimateTTSDuration(line, ttsVoice);
        const segEnd = Math.min(projectDuration, cursor + dur);
        if (segEnd - cursor < 0.3) break;
        const capId = uid('c');
        const ttsId = uid('t');
        clips.push({
          id: capId, trackId: 'caption', lane: 0, start: cursor, end: segEnd,
          text: line, style: 'meme', fontSize: 48, linkedTTSId: ttsId,
        } as Clip);
        clips.push({
          id: ttsId, trackId: 'tts', lane: 0, start: cursor, end: segEnd,
          text: line, voice: ttsVoice, linkedCaptionId: capId,
        } as Clip);
        cursor = segEnd + gap;
      }
      onAddClipsBatch(clips);
      toast.success(`✓ ${lines.length} 段台词 → 字幕 + 配音 配套生成, 已双向链接`);
    } else {
      lines.forEach(line => {
        onQuickAdd({ type: 'caption', text: line, captionStyle: 'meme', captionFontSize: 48, defaultDuration: 2.5 });
      });
      toast.success(`已加 ${lines.length} 条字幕`);
    }
    setText('');
  };
  return (
    <div className="am-cap-extra-card">
      <div className="am-cap-extra-head">📋 批量导入台词稿{isGif && <span className="am-cap-extra-sub" style={{ marginLeft: 8 }}>(GIF · 仅字幕)</span>}</div>
      {!isGif && (
        <div className="am-pair-mode-row" role="radiogroup" aria-label="生成模式">
          <button
            type="button"
            role="radio"
            aria-checked={withTTS}
            className={'am-pair-mode' + (withTTS ? ' is-active' : '')}
            onClick={() => setWithTTS(true)}
            title="每行台词同时建 1 个字幕 + 1 个配音 · 双向链接 (改一个另一个自动跟)"
          >
            <span className="am-pair-mode-ic">✨</span>
            <span className="am-pair-mode-main">字幕 + 配音 一起加</span>
            <span className="am-pair-mode-sub">推荐 · 双向链接</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!withTTS}
            className={'am-pair-mode' + (!withTTS ? ' is-active' : '')}
            onClick={() => setWithTTS(false)}
            title="仅字幕轨, 每条 2.5s 接龙"
          >
            <span className="am-pair-mode-ic">💬</span>
            <span className="am-pair-mode-main">只加字幕</span>
            <span className="am-pair-mode-sub">每条 2.5s</span>
          </button>
        </div>
      )}
      <textarea
        className="am-input am-textarea am-cap-batch-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'家人们谁懂啊\n直接裂开\n但我装作很淡定\n我可太牛了'}
        rows={5}
      />
      <button
        type="button"
        className="am-tb-btn am-tb-btn-primary am-cap-batch-add"
        onClick={doImport}
        disabled={lines.length === 0}
      >
        ✚ 加 {lines.length > 0 ? `${lines.length} 段` : ''} {effWithTTS ? '→ 字幕+配音' : '→ 字幕'}
      </button>
    </div>
  );
}
