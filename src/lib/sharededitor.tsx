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
import { useUiLang, pickLang } from '@/lib/animate-i18n';

// 沙雕动画 视频/GIF 共享面板的 i18n 字典 (跟随顶栏 中/EN 全局开关). zh 保持与改造前逐字一致.
const DICT = {
  zh: {
    comboTitle: '🐼+🤔 配套合成',
    comboSubTwo: '双图层 · 可分别套动作', comboSubOne: '单图层 · 整体一起动', comboSubVideo: '校准自动应用 · 单层加入',
    panda: '熊猫头', face: '表情',
    prev: '上一个', next: '下一个', expandPick: '点击展开全部选项手动选',
    shufflePair: '随机一对', clickDrag: '点 / 拖拽 加入', composing: '合成中…',
    layerTwo: '双层 · 可分别动', layerTwoTip: '熊猫 + 脸 拆成两图层, 各自可套不同循环动作 (脸动身体不动 等)',
    layerOne: '单层 · 整体', layerOneTip: '合成一张图层, 整体一起动 (简单稳)',
    adding: '加入中…', addTwo: '✚ 加入 · 双层', addOne: '✚ 加入 · 单层', addTimeline: '✚ 加入时间轴',
    pick: '选', searchPanda: '搜熊猫头…', searchFace: '搜表情…', noMatch: '无匹配 · 改关键词试试',
    comboPreview: '合成预览',
    addedCombo: '配套', composeFail: '合成失败',
    webSearch: '联网搜图', webSearchTip: '联网搜熊猫头表情包, 选中加入熊猫池',
    smartExtract: '智能抠脸', smartExtractTip: '上传照片智能抠出人脸, 加入表情池',
    extractLabel: '抠脸', addedToPanda: '已加入熊猫池', addedToFace: '已加入表情池',
    composeShort: '合成中…', processFail: '处理失败', del: '删除',
    cardTip: '单击或拖到时间轴', draftTip: '点击加入', draftTipSuffix: '— 画面 + 字幕 自动分轨',
    layerCount: '层', capSplit: '字幕分轨', draftFallback: '草图',
    capQuickHead: '🎲 快速生成', capQuickSub: '从快速模式池抽 · 编辑后加', defaultMode: '默认',
    defaultFull: '默认 (全池)', styleDemoTip: '样式演示 · 加时实际文字', textEmpty: '空', fontSize: '字号',
    rerollTip: '再抽一条 (避免连出同句)', reroll: '换一条', typeHere: '或直接打字',
    styleLabel: '样式', styleMeme: 'Meme', stylePanel: '白板', styleBar: '黑条',
    autoSize: '自动', autoSizeTip: '自适应: 短文案撑大 / 长文案缩小分行 (推荐, 跟随机生成一致)', adaptive: '自适应',
    colorLabel: '颜色', addCaption: '✚ 加字幕', sampleCaption: '字幕样式',
    posHead: '📍 字幕位置预设', posSub: '点一下加位置示例 · 加入后可继续拖',
    posTop: '顶部', posMidUp: '中上', posMid: '居中', posMidDown: '中下', posBottom: '底部',
    posSample: '位置示例', addedCaptionPos: '已加字幕',
    emojiHead: '🎭 沙雕表情字幕', emojiSub: '单击加一条单 emoji 字幕 · 大字号',
    emojiBtnTip1: '加', emojiBtnTip2: '表情 (自适应字号 · 1.2s · 可拖角缩放)',
    batchHead: '📋 批量导入台词稿', batchGifTag: '(GIF · 仅字幕)',
    pasteEmpty: '粘贴一段台词, 每行一条字幕',
    batchPairTitle: '每行台词同时建 1 个字幕 + 1 个配音 · 双向链接 (改一个另一个自动跟)',
    batchPairMain: '字幕 + 配音 一起加', batchPairSub: '推荐 · 双向链接',
    batchCapOnlyTitle: '仅字幕轨, 每条 2.5s 接龙', batchCapOnlyMain: '只加字幕', batchCapOnlySub: '每条 2.5s',
    batchPlaceholder: '家人们谁懂啊\n直接裂开\n但我装作很淡定\n我可太牛了',
    addBtn: '✚ 加', batchSeg: '段', batchToCap: '→ 字幕', batchToCapTTS: '→ 字幕+配音',
    batchDoneTTS1: '✓', batchDoneTTS2: '段台词 → 字幕 + 配音 配套生成, 已双向链接',
    batchDoneCap1: '已加', batchDoneCap2: '条字幕',
    radioGroup: '生成模式',
  },
  en: {
    comboTitle: '🐼+🤔 Combo',
    comboSubTwo: 'Two layers · animate each', comboSubOne: 'One layer · move together', comboSubVideo: 'Auto-aligned · single layer',
    panda: 'Panda head', face: 'Face',
    prev: 'Prev', next: 'Next', expandPick: 'Click to expand & pick manually',
    shufflePair: 'Shuffle pair', clickDrag: 'Click / drag to add', composing: 'Composing…',
    layerTwo: 'Two layers · move apart', layerTwoTip: 'Split panda + face into two layers, each can take its own loop motion (face moves, body still, etc.)',
    layerOne: 'One layer · together', layerOneTip: 'Compose into one layer, moves as a whole (simple & stable)',
    adding: 'Adding…', addTwo: '✚ Add · 2 layers', addOne: '✚ Add · 1 layer', addTimeline: '✚ Add to timeline',
    pick: 'Pick', searchPanda: 'Search panda heads…', searchFace: 'Search faces…', noMatch: 'No match · try other keywords',
    comboPreview: 'Combo preview',
    addedCombo: 'combo', composeFail: 'Compose failed',
    webSearch: 'Web search', webSearchTip: 'Search panda memes online, pick to add to panda pool',
    smartExtract: 'Cut-out face', smartExtractTip: 'Upload a photo to auto cut out the face, add to face pool',
    extractLabel: 'Face', addedToPanda: 'Added to panda pool', addedToFace: 'Added to face pool',
    composeShort: 'Composing…', processFail: 'Failed', del: 'Delete',
    cardTip: 'Click or drag to timeline', draftTip: 'Click to add', draftTipSuffix: '— image + captions auto-split into tracks',
    layerCount: 'layers', capSplit: 'caption track', draftFallback: 'Draft',
    capQuickHead: '🎲 Quick generate', capQuickSub: 'Pull from quick-mode pool · edit then add', defaultMode: 'Default',
    defaultFull: 'Default (all pools)', styleDemoTip: 'Style demo · actual text on add', textEmpty: 'empty', fontSize: 'Size',
    rerollTip: 'Roll another (avoid repeats)', reroll: 'Roll again', typeHere: 'or just type',
    styleLabel: 'Style', styleMeme: 'Meme', stylePanel: 'White', styleBar: 'Black bar',
    autoSize: 'Auto', autoSizeTip: 'Auto-fit: short text grows / long text shrinks & wraps (recommended, matches random generate)', adaptive: 'Auto-fit',
    colorLabel: 'Color', addCaption: '✚ Add caption', sampleCaption: 'Caption style',
    posHead: '📍 Caption position presets', posSub: 'Click to add a sample · keep dragging after add',
    posTop: 'Top', posMidUp: 'Upper', posMid: 'Center', posMidDown: 'Lower', posBottom: 'Bottom',
    posSample: 'Position sample', addedCaptionPos: 'Added caption',
    emojiHead: '🎭 Meme emoji captions', emojiSub: 'Click to add a single-emoji caption · big size',
    emojiBtnTip1: 'Add', emojiBtnTip2: 'emoji (auto-fit size · 1.2s · drag corner to scale)',
    batchHead: '📋 Batch import script', batchGifTag: '(GIF · captions only)',
    pasteEmpty: 'Paste a script, one caption per line',
    batchPairTitle: 'Each line builds 1 caption + 1 voice, two-way linked (edit one, the other follows)',
    batchPairMain: 'Caption + voice together', batchPairSub: 'Recommended · two-way linked',
    batchCapOnlyTitle: 'Caption track only, 2.5s each in sequence', batchCapOnlyMain: 'Captions only', batchCapOnlySub: '2.5s each',
    batchPlaceholder: 'who even gets this\njust falling apart\nbut I act all chill\nI am so winning',
    addBtn: '✚ Add', batchSeg: 'lines', batchToCap: '→ captions', batchToCapTTS: '→ captions+voice',
    batchDoneTTS1: '✓', batchDoneTTS2: 'lines → caption + voice combos, two-way linked',
    batchDoneCap1: 'Added', batchDoneCap2: 'captions',
    radioGroup: 'Generate mode',
  },
} as const;

// 拖拽 / 快速添加 的数据载体 — 组件只 emit 它, 由各 host 自行建 clip
// (video = timeline 语义 playhead+找空位; gif = 全幅 [0,duration])。这是抽取的接缝。
export interface DragPayload {
  type: TrackType;
  src?: string; label?: string;
  voice?: string; text?: string;
  bgmId?: string; name?: string;
  // 用户上传的 mp3 配音 — type:'tts' + audioSrc 直接当配音 (不走 TTS 云端生成)
  audioSrc?: string; audioDuration?: number;
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
  const lang = useUiLang();
  const t = pickLang(DICT, lang);
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
      toast.success(lang === 'en' ? `Added ${panda.labelEn}+${face.labelEn} ${t('addedCombo')}` : `已加 ${panda.labelCn}+${face.labelCn} ${t('addedCombo')}`);
    } catch {
      toast.error(t('composeFail'));
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
        <span className="am-combo-tab-title">{t('comboTitle')}</span>
        <span className="am-combo-tab-sub">{onAddCombo ? (comboLayers === 'two' ? t('comboSubTwo') : t('comboSubOne')) : t('comboSubVideo')}</span>
      </div>

      <div className="am-combo-tab-slots">
        <div className="am-combo-tab-slot">
          <div className="am-combo-tab-slot-label">{t('panda')} ({pIdx + 1}/{ALL_PANDAS.length})</div>
          <div className="am-combo-tab-slot-row">
            <button className="am-combo-arrow" onClick={() => cyclePanda(-1)} type="button" title={t('prev')}>‹</button>
            <button
              className="am-combo-tab-thumb-btn"
              onClick={() => { setPicker('panda'); setPickerQ(''); }}
              title={t('expandPick')}
              type="button"
            >
              <img src={panda.src} alt={panda.labelCn} className="am-combo-tab-thumb" draggable={false} />
              <span className="am-combo-tab-thumb-name">{lang === 'en' ? panda.labelEn : panda.labelCn}</span>
              <span className="am-combo-tab-expand">▾</span>
            </button>
            <button className="am-combo-arrow" onClick={() => cyclePanda(1)} type="button" title={t('next')}>›</button>
          </div>
        </div>

        <div className="am-combo-tab-slot">
          <div className="am-combo-tab-slot-label">{t('face')} ({fIdx + 1}/{ALL_FACES.length})</div>
          <div className="am-combo-tab-slot-row">
            <button className="am-combo-arrow" onClick={() => cycleFace(-1)} type="button" title={t('prev')}>‹</button>
            <button
              className="am-combo-tab-thumb-btn"
              onClick={() => { setPicker('face'); setPickerQ(''); }}
              title={t('expandPick')}
              type="button"
            >
              <img src={face.src} alt={face.labelCn} className="am-combo-tab-thumb" draggable={false} />
              <span className="am-combo-tab-thumb-name">{lang === 'en' ? face.labelEn : face.labelCn}</span>
              <span className="am-combo-tab-expand">▾</span>
            </button>
            <button className="am-combo-arrow" onClick={() => cycleFace(1)} type="button" title={t('next')}>›</button>
          </div>
        </div>
      </div>

      <button className="am-combo-shuffle-btn" onClick={shuffle} type="button">
        <Shuffle size={12} /> <span>{t('shufflePair')}</span>
      </button>

      <div
        className="am-combo-tab-preview"
        draggable={!!preview}
        onDragStart={onDragStart}
        title={preview ? t('clickDrag') : t('composing')}
      >
        {preview ? (
          <img src={preview} alt={t('comboPreview')} className="am-combo-tab-preview-img" draggable={false} />
        ) : (
          <div className="am-combo-preview-loading">{t('composing')}</div>
        )}
      </div>
      {onAddCombo && (
        <div className="am-combo-layers">
          <button type="button" className={'am-combo-layer-btn' + (comboLayers === 'two' ? ' is-active' : '')} onClick={() => setComboLayers('two')} title={t('layerTwoTip')}>{t('layerTwo')}</button>
          <button type="button" className={'am-combo-layer-btn' + (comboLayers === 'one' ? ' is-active' : '')} onClick={() => setComboLayers('one')} title={t('layerOneTip')}>{t('layerOne')}</button>
        </div>
      )}
      <button className="am-combo-add" onClick={handleAdd} disabled={loading || !preview} type="button">
        {loading ? t('adding') : (onAddCombo ? (comboLayers === 'two' ? t('addTwo') : t('addOne')) : t('addTimeline'))}
      </button>

      {picker && (
        <div className="am-combo-picker-overlay" onClick={() => setPicker(null)}>
          <div className="am-combo-picker win7-panel" onClick={(e) => e.stopPropagation()}>
            <div className="am-combo-picker-head">
              <span>{t('pick')} {picker === 'panda' ? t('panda') : t('face')} · {pickerList.length}/{picker === 'panda' ? ALL_PANDAS.length : ALL_FACES.length}</span>
              <button className="am-popover-close" onClick={() => setPicker(null)} type="button"><X size={14} /></button>
            </div>
            <div className="am-combo-picker-search material-search-box">
              <Search size={12} color="#888" />
              <input
                autoFocus
                type="text"
                className="material-search-input"
                placeholder={picker === 'panda' ? t('searchPanda') : t('searchFace')}
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
                    <span className="am-combo-picker-name">{lang === 'en' ? m.labelEn : m.labelCn}</span>
                  </button>
                );
              })}
              {pickerList.length === 0 && (
                <div className="am-combo-picker-empty">{t('noMatch')}</div>
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
  const lang = useUiLang();
  const t = pickLang(DICT, lang);
  const [searchOpen, setSearchOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  return (
    <div className="am-matsrc">
      {kind === 'panda' ? (
        <button type="button" className="am-tb-btn am-matsrc-btn" onClick={() => setSearchOpen(true)} title={t('webSearchTip')}>
          <Search size={13} strokeWidth={2.2} /> {t('webSearch')}
        </button>
      ) : (
        <button type="button" className="am-tb-btn am-matsrc-btn" onClick={() => setExtractOpen(true)} title={t('smartExtractTip')}>
          <Sparkles size={13} strokeWidth={2.2} /> {t('smartExtract')}
        </button>
      )}
      {searchOpen && (
        <PandaSearchModal
          open lang={lang}
          onClose={() => setSearchOpen(false)}
          onSelect={(mat) => { onAdd({ ...mat, kind: 'panda' }); setSearchOpen(false); toast.success(`${t('addedToPanda')}: ${lang === 'en' ? mat.labelEn : mat.labelCn}`); }}
        />
      )}
      {extractOpen && (
        <SmartExtractModal
          isOpen language={lang}
          onClose={() => setExtractOpen(false)}
          onConfirm={(dataUrl) => {
            onAdd({ id: `custom-face-${uid('cf')}`, src: dataUrl, labelCn: '抠脸', labelEn: 'Face', tags: ['抠脸'], tagsEn: ['face'], faceOffset: { x: 100, y: 70, w: 250, h: 250 }, kind: 'face' });
            setExtractOpen(false); toast.success(t('addedToFace'));
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
  const lang = useUiLang();
  const t = pickLang(DICT, lang);
  const dispName = lang === 'en' ? item.labelEn : item.labelCn;
  // 单独 panda/face 拖入沙雕动画时, flattenAlphaShell 把内部 transparent fill 白, 防场景透出
  // scene 不处理 (本身就是背景), upload 用户图也不动 (尊重用户原图)
  // ⚠️ 联网搜的网络梗图是「完整图」(不是透明熊猫壳): 绝不能跑 flattenAlphaShell — 否则白底填充+四角洪泛
  //    会把整张梗图填白/抠烂 (= 用户报的「联网搜在沙雕动画完全不可用」根因). 网络图 id 恒以 network- 开头, 直接用原图.
  const isNetworkFullImage = item.kind === 'network' || item.id.startsWith('network-');
  const needsFlattenShell = (kind === 'panda' || kind === 'face') && !isNetworkFullImage;
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
    const tid = needsFlattenShell ? toast.loading(t('composeShort')) : null;
    try {
      const payload = await buildPayload();
      if (tid) toast.dismiss(tid);
      onQuickAdd(payload);
    } catch (e) {
      if (tid) toast.dismiss(tid);
      toast.error(t('processFail') + ': ' + (e as Error).message);
    }
  }, [buildPayload, needsFlattenShell, onQuickAdd, t]);
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
      title={`${t('cardTip')}: ${dispName}`}
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
      <span className="material-name">{dispName}</span>
      {item.tags.length > 0 && kind !== 'scene' && (
        <div className="material-tags">
          {(lang === 'en' && item.tagsEn?.length ? item.tagsEn : item.tags).slice(0, 2).map(tg => <span key={tg} className="material-tag">{tg}</span>)}
        </div>
      )}
      {onDelete && (
        <button className="am-card-del" onClick={(e) => { e.stopPropagation(); onDelete(); }} title={t('del')}>
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
  const lang = useUiLang();
  const t = pickLang(DICT, lang);
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
      title={`${t('draftTip')}: ${name} ${t('draftTipSuffix')}`}
    >
      {previewUrl ? (
        <img src={previewUrl} alt={name} className="material-img am-img-draft" draggable={false} loading="lazy" />
      ) : (
        <div className="material-img am-draft-blank">—</div>
      )}
      <span className="material-name">{name}</span>
      <div className="material-tags">
        <span className="material-tag">{elementCount} {t('layerCount')}</span>
        {hasText && <span className="material-tag am-draft-tag-cap">{t('capSplit')}</span>}
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

// 字幕快速生成 — 从 quickModeTexts 随机出文字 + 用户调样式 → 拖/单击加
export function CaptionQuickGen({ onQuickAdd }: { onQuickAdd: (p: DragPayload) => void }) {
  const lang = useUiLang();
  const t = pickLang(DICT, lang);
  const [mode, setMode] = useState<CaptionMode | 'all'>('all');
  const [text, setText] = useState(() => pickRandomText('zh', 'all') || '点击编辑字幕');
  const [style, setStyle] = useState<CaptionStyle>('meme');
  const [fontSize, setFontSize] = useState(56);
  const [autoSize, setAutoSize] = useState(true);   // 默认自适应字号 (全站统一); 动滑块才转固定
  const [color, setColor] = useState('#ffffff');
  const reroll = useCallback(() => {
    const t = pickRandomText('zh', mode, text);
    if (t) setText(t);
  }, [mode, text]);
  const payload: DragPayload = useMemo(() => ({
    type: 'caption',
    text,
    captionStyle: style,
    captionFontSize: autoSize ? undefined : fontSize,   // 自动 = 不写 → 自适应字号
    captionColor: color,
    defaultDuration: 2.5,
  }), [text, style, fontSize, color, autoSize]);
  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/x-meme', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };
  const MODE_BTNS: (CaptionMode | 'all')[] = ['all', 'roast', 'fomo', 'fud'];
  return (
    <div className="am-cap-quick win7-panel">
      <div className="am-cap-quick-head">
        <span>{t('capQuickHead')}</span>
        <span className="am-cap-quick-sub">{t('capQuickSub')}</span>
      </div>
      <div className="am-cap-quick-modes">
        {MODE_BTNS.map(m => (
          <button
            key={m}
            type="button"
            className={'am-cap-quick-mode' + (mode === m ? ' is-active' : '')}
            onClick={() => { setMode(m); const r = pickRandomText('zh', m); if (r) setText(r); }}
            title={m === 'all' ? t('defaultFull') : CAPTION_MODE_LABELS[m]?.[lang] ?? m}
          >
            {m === 'all' ? t('defaultMode') : CAPTION_MODE_LABELS[m]?.[lang] ?? m}
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
        title={`${t('styleDemoTip')}: "${text || t('textEmpty')}" · ${t('fontSize')} ${fontSize}px`}
      >
        {t('sampleCaption')}
      </div>
      <div className="am-row am-row-tight" style={{ marginTop: 6 }}>
        <button type="button" className="am-tb-btn" onClick={reroll} title={t('rerollTip')}>
          <Shuffle size={11} /> {t('reroll')}
        </button>
        <input
          type="text"
          className="am-input am-cap-quick-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('typeHere')}
          maxLength={80}
        />
      </div>
      <div className="am-cap-quick-row">
        <span className="am-cap-quick-label">{t('styleLabel')}</span>
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
              {s === 'meme' ? t('styleMeme') : s === 'panel' ? t('stylePanel') : t('styleBar')}
            </button>
          ))}
        </div>
      </div>
      <div className="am-cap-quick-row">
        <span className="am-cap-quick-label">{t('fontSize')}</span>
        <button type="button" onClick={() => setAutoSize(a => !a)} title={t('autoSizeTip')}
          style={{ padding: '2px 8px', borderRadius: 5, border: '1px solid', borderColor: autoSize ? '#FF5E00' : '#cbd5e1', background: autoSize ? '#fff4ec' : '#fff', color: autoSize ? '#c84a00' : '#64748b', fontSize: 11, fontWeight: 700, cursor: 'pointer', flex: 'none' }}>{t('autoSize')}</button>
        <input
          type="range" min="20" max="100" step="2"
          value={fontSize}
          disabled={autoSize}
          onChange={(e) => { setAutoSize(false); setFontSize(parseInt(e.target.value)); }}
          className="am-range am-cap-quick-range"
          style={{ opacity: autoSize ? 0.4 : 1 }}
        />
        <span className="am-cap-quick-val">{autoSize ? t('adaptive') : fontSize}</span>
      </div>
      <div className="am-cap-quick-row">
        <span className="am-cap-quick-label">{t('colorLabel')}</span>
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
        {t('addCaption')}
      </button>
    </div>
  );
}

// 字幕位置预设 — 5 个常用位置. captionTransform 真正定位 (gif host 应用; video host 忽略, 同旧行为)
export function CaptionPositionPresets({ onQuickAdd }: { onQuickAdd: (p: DragPayload) => void }) {
  const lang = useUiLang();
  const t = pickLang(DICT, lang);
  const presets: { id: string; labelKey: 'posTop' | 'posMidUp' | 'posMid' | 'posMidDown' | 'posBottom'; x: number; y: number; emoji: string }[] = [
    { id: 'top',       labelKey: 'posTop',     x: 0,  y: -35, emoji: '⬆️' },
    { id: 'mid-up',    labelKey: 'posMidUp',   x: 0,  y: -15, emoji: '↗' },
    { id: 'mid',       labelKey: 'posMid',     x: 0,  y: 0,   emoji: '·' },
    { id: 'mid-down',  labelKey: 'posMidDown', x: 0,  y: 15,  emoji: '↘' },
    { id: 'bottom',    labelKey: 'posBottom',  x: 0,  y: 35,  emoji: '⬇️' },
  ];
  const addAt = (p: typeof presets[number]) => {
    onQuickAdd({
      type: 'caption', text: '位置示例', captionStyle: 'meme',   // 不写 captionFontSize → 自适应字号 (短超大/长缩字, 跟随机生成一致)
      defaultDuration: 2.5, captionTransform: { x: p.x, y: p.y },
    });
    toast(`${t('addedCaptionPos')}${lang === 'en' ? ' ' : ' · '}${t(p.labelKey)}`, { duration: 2000 });
  };
  return (
    <div className="am-cap-extra-card">
      <div className="am-cap-extra-head">{t('posHead')}</div>
      <div className="am-cap-extra-sub">{t('posSub')}</div>
      <div className="am-cap-pos-grid">
        {presets.map(p => (
          <button key={p.id} type="button" className="am-cap-pos-btn" onClick={() => addAt(p)} title={`y=${p.y}%`}>
            <span className="am-cap-pos-icon">{p.emoji}</span>
            <span className="am-cap-pos-label">{t(p.labelKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// 沙雕常用 emoji 一键插入 — 单 emoji 字幕, 大字号
export function CaptionEmojiPicker({ onQuickAdd }: { onQuickAdd: (p: DragPayload) => void }) {
  const lang = useUiLang();
  const t = pickLang(DICT, lang);
  const emojis = ['😂', '🤣', '💀', '🐼', '🤡', '🥹', '🫠', '😭', '👀', '👻', '💩', '🔥', '✨', '💯', '🙏', '🤝'];
  return (
    <div className="am-cap-extra-card">
      <div className="am-cap-extra-head">{t('emojiHead')}</div>
      <div className="am-cap-extra-sub">{t('emojiSub')}</div>
      <div className="am-cap-emoji-grid">
        {emojis.map(e => (
          <button
            key={e}
            type="button"
            className="am-cap-emoji-btn"
            onClick={() => onQuickAdd({ type: 'caption', text: e, captionStyle: 'meme', defaultDuration: 1.2 })}
            title={`${t('emojiBtnTip1')} ${e} ${t('emojiBtnTip2')}`}
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
  const lang = useUiLang();
  const t = pickLang(DICT, lang);
  const [text, setText] = useState('');
  const [withTTS, setWithTTS] = useState(!isGif);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const effWithTTS = !isGif && withTTS;
  const doImport = () => {
    if (lines.length === 0) { toast.error(t('pasteEmpty')); return; }
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
          text: line, style: 'meme', linkedTTSId: ttsId,   // 不写 fontSize → 自适应字号
        } as Clip);
        clips.push({
          id: ttsId, trackId: 'tts', lane: 0, start: cursor, end: segEnd,
          text: line, voice: ttsVoice, linkedCaptionId: capId,
        } as Clip);
        cursor = segEnd + gap;
      }
      onAddClipsBatch(clips);
      toast.success(`${t('batchDoneTTS1')} ${lines.length} ${t('batchDoneTTS2')}`);
    } else {
      lines.forEach(line => {
        onQuickAdd({ type: 'caption', text: line, captionStyle: 'meme', defaultDuration: 2.5 });   // 自适应字号
      });
      toast.success(`${t('batchDoneCap1')} ${lines.length} ${t('batchDoneCap2')}`);
    }
    setText('');
  };
  return (
    <div className="am-cap-extra-card">
      <div className="am-cap-extra-head">{t('batchHead')}{isGif && <span className="am-cap-extra-sub" style={{ marginLeft: 8 }}>{t('batchGifTag')}</span>}</div>
      {!isGif && (
        <div className="am-pair-mode-row" role="radiogroup" aria-label={t('radioGroup')}>
          <button
            type="button"
            role="radio"
            aria-checked={withTTS}
            className={'am-pair-mode' + (withTTS ? ' is-active' : '')}
            onClick={() => setWithTTS(true)}
            title={t('batchPairTitle')}
          >
            <span className="am-pair-mode-ic">✨</span>
            <span className="am-pair-mode-main">{t('batchPairMain')}</span>
            <span className="am-pair-mode-sub">{t('batchPairSub')}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!withTTS}
            className={'am-pair-mode' + (!withTTS ? ' is-active' : '')}
            onClick={() => setWithTTS(false)}
            title={t('batchCapOnlyTitle')}
          >
            <span className="am-pair-mode-ic">💬</span>
            <span className="am-pair-mode-main">{t('batchCapOnlyMain')}</span>
            <span className="am-pair-mode-sub">{t('batchCapOnlySub')}</span>
          </button>
        </div>
      )}
      <textarea
        className="am-input am-textarea am-cap-batch-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('batchPlaceholder')}
        rows={5}
      />
      <button
        type="button"
        className="am-tb-btn am-tb-btn-primary am-cap-batch-add"
        onClick={doImport}
        disabled={lines.length === 0}
      >
        {t('addBtn')} {lines.length > 0 ? `${lines.length} ${t('batchSeg')}` : ''} {effWithTTS ? t('batchToCapTTS') : t('batchToCap')}
      </button>
    </div>
  );
}
