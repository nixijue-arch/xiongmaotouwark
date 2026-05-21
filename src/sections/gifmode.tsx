// gifmode.tsx — GIF 循环编辑器 (独立板块, 与 animate 视频编辑器完全隔离)
// 范式: 循环优先. clips 全是 [0,duration] 全幅图层 (无时间轴), 循环本身取代时间轴.
// 复用 animcore 纯渲染核心 + gifloop 循环引擎. 绝不 import animatemode (避免拉起 audio 单例).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Download, Repeat, Trash2, Upload, Loader2, FlipHorizontal, Type as TypeIcon } from 'lucide-react';
import { toast } from 'sonner';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { ALL_PANDAS, ALL_FACES, type Material } from '@/data/materials';
import { useIsMobile } from '@/hooks/usemediaquery';
import {
  loadMedia, GIF_PRESETS, GIF_MAX_DURATION, GIF_MIN_DURATION,
  DEFAULT_TRANSFORM, DEFAULT_CAPTION_TRANSFORM,
  type MediaAsset, type Clip, type ImageClip, type CaptionClip, type Transform,
  type GifPresetId, type LoopMotionKind,
} from '@/lib/animcore';
import {
  type GifProject, type GifLoopMode, DEFAULT_LOOP_CONFIG,
  loopTimeMap, renderLoopFrame, makeLoopMotionAt, loopSeamScore, exportGIFLoop,
} from '@/lib/gifloop';
import './gifmode.css';

const GIF_PROJECT_IDB_KEY = 'xiongmaotou.gifmode-current.v1';
const uid = (p = 'g') => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const LOOP_MOTIONS: { kind: LoopMotionKind; label: string; emoji: string }[] = [
  { kind: 'none', label: '静止', emoji: '⏸️' },
  { kind: 'bob', label: '上下浮', emoji: '↕️' },
  { kind: 'shimmy', label: '左右抖', emoji: '↔️' },
  { kind: 'sway', label: '摇摆', emoji: '🙃' },
  { kind: 'breathe', label: '呼吸', emoji: '🫁' },
  { kind: 'pulseLoop', label: '脉冲', emoji: '💓' },
  { kind: 'spin360', label: '整圈转', emoji: '🔄' },
  { kind: 'float', label: '8字漂', emoji: '🎈' },
];

const LOOP_MODES: { mode: GifLoopMode; label: string; hint: string }[] = [
  { mode: 'normal', label: '直接循环', hint: '播完跳回头 (适合本来就闭环的动作)' },
  { mode: 'boomerang', label: 'Boomerang 乒乓', hint: '正放→倒放, 任何动作都首尾无缝' },
];

function makeDefaultGifProject(): GifProject {
  const panda = ALL_PANDAS[7] ?? ALL_PANDAS[0];
  const preset = GIF_PRESETS[0]; // wechat
  const dur = preset.defaultDuration;
  const clip: ImageClip = {
    id: uid('img'), trackId: 'image', lane: 0, start: 0, end: dur,
    src: panda.src, label: panda.labelCn, fx: 'none',
    transform: { ...DEFAULT_TRANSFORM }, loopMotion: { kind: 'bob', amp: 1, cycles: 1 },
  };
  return {
    kind: 'gif-project', version: 1,
    duration: dur, preset: preset.id,
    lanes: { image: 1, caption: 1, fx: 1 },
    loop: { ...DEFAULT_LOOP_CONFIG },
    clips: [clip],
  };
}

export function GifMode() {
  const isMobile = useIsMobile();
  const [project, setProject] = useState<GifProject>(() => makeDefaultGifProject());
  const [hydrated, setHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [seam, setSeam] = useState<number | null>(null);
  const [subjectTab, setSubjectTab] = useState<'panda' | 'face'>('panda');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef<Map<string, MediaAsset>>(new Map());
  const [cacheVer, setCacheVer] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // rAF 用 ref 读最新值, 避免每次编辑都拆/重建动画循环
  const projectRef = useRef(project); projectRef.current = project;
  const playingRef = useRef(playing); playingRef.current = playing;
  const startRef = useRef(performance.now());
  const frozenRef = useRef(0);

  const preset = useMemo(() => GIF_PRESETS.find(p => p.id === project.preset) ?? GIF_PRESETS[0], [project.preset]);
  const D = project.duration;
  const selected = project.clips.find(c => c.id === selectedId) ?? null;
  const imageClips = project.clips.filter(c => c.trackId === 'image') as ImageClip[];
  const frameCount = Math.max(1, Math.round(D * preset.fps));
  const exportFrames = project.loop.mode === 'boomerang' ? Math.max(1, frameCount * 2 - 2) : frameCount;

  // hydrate
  useEffect(() => {
    let alive = true;
    idbGet<GifProject>(GIF_PROJECT_IDB_KEY).then(saved => {
      if (alive && saved && saved.kind === 'gif-project' && Array.isArray(saved.clips) && saved.clips.length) {
        setProject(saved);
      }
      if (alive) setHydrated(true);
    }).catch(() => { if (alive) setHydrated(true); });
    return () => { alive = false; };
  }, []);

  // 选中初始化 (hydrate 后选第一个 image)
  useEffect(() => {
    if (!selectedId && project.clips.length) {
      setSelectedId((project.clips.find(c => c.trackId === 'image') ?? project.clips[0]).id);
    }
  }, [project.clips, selectedId]);

  // persist (debounce)
  useEffect(() => {
    if (!hydrated) return;
    const t = window.setTimeout(() => { void idbSet(GIF_PROJECT_IDB_KEY, project).catch(() => {}); }, 250);
    return () => window.clearTimeout(t);
  }, [project, hydrated]);

  // 加载素材到 cache
  useEffect(() => {
    const srcs = Array.from(new Set(imageClips.map(c => c.src)));
    let alive = true;
    Promise.all(srcs.map(async src => {
      if (cacheRef.current.has(src)) return;
      try { const m = await loadMedia(src); if (alive) cacheRef.current.set(src, m); } catch { /* skip */ }
    })).then(() => { if (alive) setCacheVer(v => v + 1); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.clips]);

  // rAF 连续循环预览 (mount-once, 读 ref)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const p = projectRef.current;
      const pr = GIF_PRESETS.find(x => x.id === p.preset) ?? GIF_PRESETS[0];
      const w = pr.width, h = pr.height, dd = p.duration;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const now = performance.now();
      const playPos = playingRef.current ? (now - startRef.current) / 1000 : frozenRef.current;
      const t = loopTimeMap(playPos, dd, p.loop.mode);
      renderLoopFrame(ctx, { t }, p, w, h, cacheRef.current, makeLoopMotionAt(dd, w));
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 循环质量评分
  useEffect(() => {
    if (!project.loop.showSeamScore) { setSeam(null); return; }
    if (project.loop.mode === 'boomerang') { setSeam(0); return; }
    const tid = window.setTimeout(() => {
      try {
        const w = preset.width, h = preset.height;
        const c0 = document.createElement('canvas'); c0.width = w; c0.height = h;
        const c1 = document.createElement('canvas'); c1.width = w; c1.height = h;
        const x0 = c0.getContext('2d', { alpha: false });
        const x1 = c1.getContext('2d', { alpha: false });
        if (!x0 || !x1) return;
        const motionAt = makeLoopMotionAt(D, w);
        renderLoopFrame(x0, { t: 0 }, project, w, h, cacheRef.current, motionAt);
        renderLoopFrame(x1, { t: Math.max(0, D - 1 / preset.fps) }, project, w, h, cacheRef.current, motionAt);
        setSeam(loopSeamScore(c0, c1));
      } catch { /* ignore */ }
    }, 200);
    return () => window.clearTimeout(tid);
  }, [project, cacheVer, D, preset]);

  // ---- mutators ----
  const patchClip = useCallback((id: string, patch: Partial<ImageClip> | Partial<CaptionClip>) => {
    setProject(p => ({ ...p, clips: p.clips.map(c => (c.id === id ? ({ ...c, ...patch } as Clip) : c)) }));
  }, []);
  const patchTransform = useCallback((id: string, partial: Partial<Transform>) => {
    setProject(p => ({
      ...p,
      clips: p.clips.map(c => {
        if (c.id !== id || c.trackId !== 'image') return c;
        const cur = (c as ImageClip).transform ?? DEFAULT_TRANSFORM;
        return { ...c, transform: { ...cur, ...partial } } as Clip;
      }),
    }));
  }, []);

  const addSubject = useCallback((m: Material) => {
    const id = uid('img');
    setProject(p => {
      const clip: ImageClip = {
        id, trackId: 'image', lane: 0, start: 0, end: p.duration,
        src: m.src, label: m.labelCn, fx: 'none',
        transform: { ...DEFAULT_TRANSFORM }, loopMotion: { kind: 'none', amp: 1, cycles: 1 },
      };
      // 新主体放最上层 (lane 0), 其余下移
      const bumped = p.clips.map(c => (c.trackId === 'image' ? { ...c, lane: c.lane + 1 } as Clip : c));
      return { ...p, clips: [...bumped, clip] };
    });
    setSelectedId(id);
  }, []);

  const addCaption = useCallback(() => {
    const id = uid('cap');
    setProject(p => {
      const clip: CaptionClip = {
        id, trackId: 'caption', lane: 0, start: 0, end: p.duration,
        text: '双击编辑文字', style: 'meme', transform: { ...DEFAULT_CAPTION_TRANSFORM },
      };
      return { ...p, clips: [...p.clips, clip] };
    });
    setSelectedId(id);
  }, []);

  const setMotion = useCallback((kind: LoopMotionKind) => {
    if (!selected || selected.trackId !== 'image') { toast('先选一个图片主体'); return; }
    patchClip(selected.id, { loopMotion: { kind, amp: (selected as ImageClip).loopMotion?.amp ?? 1, cycles: (selected as ImageClip).loopMotion?.cycles ?? 1 } });
  }, [selected, patchClip]);

  const deleteClip = useCallback((id: string) => {
    setProject(p => ({ ...p, clips: p.clips.filter(c => c.id !== id) }));
    setSelectedId(prev => (prev === id ? null : prev));
  }, []);

  const setDuration = useCallback((d: number) => {
    const dd = Math.max(GIF_MIN_DURATION, Math.min(d, GIF_MAX_DURATION, preset.maxDuration));
    setProject(p => ({ ...p, duration: dd, clips: p.clips.map(c => ({ ...c, start: 0, end: dd } as Clip)) }));
  }, [preset]);

  const setPresetId = useCallback((id: GifPresetId) => {
    const pr = GIF_PRESETS.find(x => x.id === id) ?? GIF_PRESETS[0];
    setProject(p => {
      const dd = Math.min(p.duration, pr.maxDuration, GIF_MAX_DURATION);
      return { ...p, preset: id, duration: dd, clips: p.clips.map(c => ({ ...c, start: 0, end: dd } as Clip)) };
    });
  }, []);

  const setLoopMode = useCallback((mode: GifLoopMode) => {
    setProject(p => ({ ...p, loop: { ...p.loop, mode } }));
  }, []);

  const togglePlay = useCallback(() => {
    const now = performance.now();
    if (playing) { frozenRef.current = (now - startRef.current) / 1000; }
    else { startRef.current = now - frozenRef.current * 1000; }
    setPlaying(v => !v);
  }, [playing]);

  const onUpload = useCallback((file: File) => {
    if (file.size > 30 * 1024 * 1024) { toast.error('文件超过 30MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      if (!src) return;
      const id = uid('up');
      setProject(p => {
        const clip: ImageClip = {
          id, trackId: 'image', lane: 0, start: 0, end: p.duration,
          src, label: file.name.slice(0, 16), fx: 'none',
          transform: { ...DEFAULT_TRANSFORM }, loopMotion: { kind: 'none', amp: 1, cycles: 1 },
        };
        const bumped = p.clips.map(c => (c.trackId === 'image' ? { ...c, lane: c.lane + 1 } as Clip : c));
        return { ...p, clips: [...bumped, clip] };
      });
      setSelectedId(id);
      toast.success('已添加上传素材');
    };
    reader.readAsDataURL(file);
  }, []);

  const onExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    const tid = toast.loading('正在生成 GIF…');
    try {
      const r = await exportGIFLoop(project, '熊猫头循环', () => {});
      toast.success(`导出成功 · ${(r.size / 1024).toFixed(0)}KB · ${r.frameCount}帧 · ${r.width}×${r.height}`, { id: tid });
    } catch (e) {
      toast.error('导出失败: ' + (e instanceof Error ? e.message : '未知错误'), { id: tid });
    } finally {
      setExporting(false);
    }
  }, [project, exporting]);

  const selImg = selected && selected.trackId === 'image' ? (selected as ImageClip) : null;
  const selCap = selected && selected.trackId === 'caption' ? (selected as CaptionClip) : null;
  const tr = selImg?.transform ?? DEFAULT_TRANSFORM;

  return (
    <div className={`gm-root${isMobile ? ' gm-mobile' : ''}`}>
      {/* ===== 顶栏 ===== */}
      <div className="gm-topbar">
        <div className="gm-brand"><Repeat size={16} /> GIF 循环</div>
        <div className="gm-presets">
          {GIF_PRESETS.map(p => (
            <button key={p.id} title={p.note}
              className={`gm-chip${project.preset === p.id ? ' active' : ''}`}
              onClick={() => setPresetId(p.id)}>{p.label}</button>
          ))}
        </div>
        <div className="gm-dur">
          <span>{D.toFixed(1)}s</span>
          <input type="range" min={GIF_MIN_DURATION} max={Math.min(GIF_MAX_DURATION, preset.maxDuration)} step={0.5}
            value={D} onChange={e => setDuration(Number(e.target.value))} />
        </div>
        <div className="gm-loopmode">
          {LOOP_MODES.map(m => (
            <button key={m.mode} title={m.hint}
              className={`gm-chip${project.loop.mode === m.mode ? ' active' : ''}`}
              onClick={() => setLoopMode(m.mode)}>{m.label}</button>
          ))}
        </div>
        <button className="gm-export" onClick={onExport} disabled={exporting}>
          {exporting ? <Loader2 size={15} className="gm-spin" /> : <Download size={15} />}
          {exporting ? '生成中' : '导出 GIF'}
        </button>
      </div>

      <div className="gm-body">
        {/* ===== 左: 主体 + 动作 + 字幕 ===== */}
        <aside className="gm-left">
          <div className="gm-sec-title">主体</div>
          <div className="gm-subtabs">
            <button className={subjectTab === 'panda' ? 'active' : ''} onClick={() => setSubjectTab('panda')}>熊猫头</button>
            <button className={subjectTab === 'face' ? 'active' : ''} onClick={() => setSubjectTab('face')}>表情脸</button>
            <button onClick={() => fileInputRef.current?.click()}><Upload size={13} /> 上传</button>
            <input ref={fileInputRef} type="file" accept="image/*" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ''; }} />
          </div>
          <div className="gm-grid">
            {(subjectTab === 'panda' ? ALL_PANDAS : ALL_FACES).slice(0, 60).map(m => (
              <button key={m.id} className="gm-mat" title={m.labelCn} onClick={() => addSubject(m)}>
                <img src={m.src} alt={m.labelCn} loading="lazy" />
              </button>
            ))}
          </div>

          <div className="gm-sec-title">循环动作 <span className="gm-hint">(选中主体后点)</span></div>
          <div className="gm-motions">
            {LOOP_MOTIONS.map(m => (
              <button key={m.kind}
                className={`gm-motion${selImg?.loopMotion?.kind === m.kind ? ' active' : ''}`}
                onClick={() => setMotion(m.kind)}>
                <span className="gm-motion-emoji">{m.emoji}</span>{m.label}
              </button>
            ))}
          </div>

          <button className="gm-addcap" onClick={addCaption}><TypeIcon size={14} /> 加字幕</button>
        </aside>

        {/* ===== 中: 预览 ===== */}
        <main className="gm-center">
          <div className="gm-stage">
            <canvas ref={canvasRef} className="gm-canvas" style={{ aspectRatio: `${preset.width}/${preset.height}` }} />
            {project.loop.showSeamScore && seam !== null && (
              <div className={`gm-seam${seam <= 6 ? ' good' : seam <= 18 ? ' ok' : ' bad'}`}>
                {project.loop.mode === 'boomerang'
                  ? 'Boomerang · 首尾完美'
                  : `循环顺滑度 ${Math.max(0, 100 - seam)}/100`}
              </div>
            )}
          </div>
          <div className="gm-transport">
            <button onClick={togglePlay}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
            <span className="gm-meta">{preset.width}×{preset.height} · {preset.fps}fps · ~{exportFrames}帧{project.loop.mode === 'boomerang' ? ' (乒乓)' : ''}</span>
          </div>
        </main>

        {/* ===== 右: 图层 + 检视 ===== */}
        <aside className="gm-right">
          <div className="gm-sec-title">图层</div>
          <div className="gm-layers">
            {project.clips.length === 0 && <div className="gm-empty">空 — 左侧加个主体</div>}
            {[...project.clips].reverse().map(c => (
              <div key={c.id} className={`gm-layer${c.id === selectedId ? ' active' : ''}`} onClick={() => setSelectedId(c.id)}>
                <span className="gm-layer-name">{c.trackId === 'image' ? (c as ImageClip).label : '字幕: ' + (c as CaptionClip).text.slice(0, 8)}</span>
                <button className="gm-del" onClick={e => { e.stopPropagation(); deleteClip(c.id); }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>

          {selImg && (
            <div className="gm-inspect">
              <div className="gm-sec-title">主体: {selImg.label}</div>
              <Range label="水平" min={-50} max={50} step={1} value={tr.x} onChange={v => patchTransform(selImg.id, { x: v })} />
              <Range label="垂直" min={-50} max={50} step={1} value={tr.y} onChange={v => patchTransform(selImg.id, { y: v })} />
              <Range label="缩放" min={0.2} max={3} step={0.05} value={tr.scale} onChange={v => patchTransform(selImg.id, { scale: v })} />
              <Range label="旋转" min={-180} max={180} step={1} value={tr.rotation} onChange={v => patchTransform(selImg.id, { rotation: v })} />
              <button className="gm-flip" onClick={() => patchTransform(selImg.id, { flipX: !tr.flipX })}>
                <FlipHorizontal size={13} /> 水平翻转 {tr.flipX ? '✓' : ''}
              </button>
              {selImg.loopMotion && selImg.loopMotion.kind !== 'none' && (
                <>
                  <Range label="动作幅度" min={0} max={1.5} step={0.05} value={selImg.loopMotion.amp}
                    onChange={v => patchClip(selImg.id, { loopMotion: { ...selImg.loopMotion!, amp: v } })} />
                  <Range label="周期数" min={1} max={6} step={1} value={selImg.loopMotion.cycles}
                    onChange={v => patchClip(selImg.id, { loopMotion: { ...selImg.loopMotion!, cycles: v } })} />
                </>
              )}
            </div>
          )}

          {selCap && (
            <div className="gm-inspect">
              <div className="gm-sec-title">字幕</div>
              <textarea className="gm-capinput" value={selCap.text} rows={2}
                onChange={e => patchClip(selCap.id, { text: e.target.value })} />
              <div className="gm-capstyles">
                {(['meme', 'panel', 'bar'] as const).map(s => (
                  <button key={s} className={selCap.style === s ? 'active' : ''} onClick={() => patchClip(selCap.id, { style: s })}>{s}</button>
                ))}
              </div>
              <Range label="垂直位置" min={-50} max={50} step={1} value={selCap.transform?.y ?? 35}
                onChange={v => patchClip(selCap.id, { transform: { x: selCap.transform?.x ?? 0, y: v } })} />
            </div>
          )}

          {!selected && <div className="gm-inspect"><div className="gm-empty">选一个图层来编辑</div></div>}
        </aside>
      </div>
    </div>
  );
}

function Range({ label, min, max, step, value, onChange }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <label className="gm-range">
      <span>{label}<b>{Number.isInteger(value) ? value : value.toFixed(2)}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}
