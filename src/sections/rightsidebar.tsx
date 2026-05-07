import { useState, useCallback } from 'react';
import { useMeme } from '@/context/memecontext';
import { useIsMobile } from '@/hooks/usemediaquery';
import type { ImageElement, TextElement, MemeElement } from '@/context/memecontext';
import { Download, Trash2, Shuffle, Image, MessageCircle, Sparkles, Settings2, Upload, X, ChevronUp, Camera, Type, AlignLeft, AlignCenter, AlignRight, Bold } from 'lucide-react';
import html2canvas from 'html2canvas';
import { PANDA_HEADS, FACES, getPandaFaceOffset } from '@/data/materials';
import { PhotoCropModal } from '@/components/photocropmodal';

const ZH_TEXTS = ['在？V我50','我不做人啦！','就这？','你不对劲','尊嘟假嘟','蚌埠住了','这波在大气层','笑死我了','开始你的表演','啊对对对','我真的会谢','无所谓我会出手','这就是中国速度','啊这','你在教我做事？','问题不大','我直接自信','这很合理','有内味了','气氛到这了','家人们谁懂啊','这班不上也罢','我说的是真的','这就是格局','我是废物','我裂开了','太对了哥','反杀反杀！','？？？','我先run了','上班哪有不疯的','这谁顶得住','差不多得了','这合理吗','我已经报警了','再装我就哭了','不可能的','你礼貌吗','给跪了','打工人打工魂','开摆','绷不住了','汗流浃背了','人间真实','笑不活了','绝了','6','小丑竟是我自己','速速撤退','毁灭吧','一键三连','下次一定','高产似那啥','cargo降落伞','我太难了','高手过招','有点意思','不太对劲','这就是实力','啊对对对','梦幻联动','血赚','亏麻了','原地起飞','给我整不会了','离谱','抽象','狠狠拿捏了','重拳出击','纯路人','理性讨论','有一说一','确实','龟龟','吓得我水都喷了','很有精神','一般般啦','祖安钢琴家','这波我必C','你完了','听我狡辩','满脸写着开心','为什么总是我','麻了','我悟了','佛了','杠精退散','老实人','正能量嗷','格局打开','毕竟我也不是什么恶魔','说出来你可能不信','此时一位靓仔路过','先赌为敬','重在参与','赢了会所嫩模','输了下海干活','问题不大'];

const EN_TEXTS = ['V me 50 plz','I quit!','Really?','You sus','No cap fr fr','I cant even','Big brain move','LMAO','Show me what you got','Yeah sure buddy','Im dead','I got this','China speed','Oh no','You telling ME?','No problemo','Straight up confident','Makes sense','Thats the vibe','It is what it is','No shot','Thats crazy','Say less','Bet','Slay','I cant breathe','On god','Periodt','Not even close','Im out','Touch grass','Skill issue','Ratio','Cooked','GG no re','Shaking rn','Bruh','Who asked','Sir this is a Wendys','RIP','F in the chat','Just vibing','Built different','Unhinged','Delulu','Main character energy','Rent free','Gatekeeping','Gaslight gatekeep girlboss','Understood the assignment','Thats suspicious','Its giving','Yassified','Aesthetic','Sheesh','Bussin','Mid','Based','Cringe','Doomer','Goblin mode','Rizz','GigaChad','Absolute cinema','Im cooked','Down bad','W rizz','L take','NPC behavior','Caught in 4k','Hes so real','Not the main character','Fumble','Down horrendous','Its joever','Mogging','Looksmaxxing','Mewing','Huzz','Edging','Ohio','Only in Ohio','Griddy','Suiii','Carti better','Dreamybull','Ambatakum','Quandale dingle','What the sigma','Baby gronk','Livvy dunne rizzing up baby gronk','Fanum tax','Skibidi toilet','Gyatt','Looksmaxxed','Mog or be mogged','Edge or be edged','High T','Low value male','High value male','Alpha wolf','Beta cuck','Sigma grindset','Top G','Matrix is real','Wake up babe','New just dropped','Fake it till you make it','Suffering from success','Another one','You smart','You loyal','I appreciate you','Major key'];

function isPanda(e: MemeElement): boolean {
  if (e.type !== 'image') return false;
  const name = (e as ImageElement).name;
  return PANDA_HEADS.some(p => p.id === name) || name.startsWith('upload-panda-');
}

function isFace(e: MemeElement): boolean {
  if (e.type !== 'image') return false;
  const name = (e as ImageElement).name;
  return FACES.some(f => f.id === name) || name.startsWith('upload-face-') || name.startsWith('custom-face-');
}

export function RightSidebar({ canvasRef }: { canvasRef: React.RefObject<HTMLDivElement | null> }) {
  const { state, dispatch, t, generateId } = useMeme();
  const isMobile = useIsMobile();
  const [isExporting, setIsExporting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const handleExport = async () => {
    if (!canvasRef.current) return;
    if (state.elements.length === 0) {
      alert(state.language === 'zh' ? '画布为空' : 'Canvas is empty');
      return;
    }
    setIsExporting(true);
    const prevSelected = state.selectedId;
    dispatch({ type: 'SELECT_ELEMENT', id: null });
    await new Promise(r => setTimeout(r, 300));
    try {
      const canvas = await html2canvas(canvasRef.current, {
        backgroundColor: '#FFFFFF', scale: 2, useCORS: true, allowTaint: true,
        logging: false, foreignObjectRendering: false, imageTimeout: 5000,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `memeforge-${Date.now()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      console.error('Export failed:', err);
      alert(state.language === 'zh' ? '导出失败' : 'Export failed');
    } finally {
      setIsExporting(false);
      if (prevSelected) dispatch({ type: 'SELECT_ELEMENT', id: prevSelected });
    }
  };

  const handleClearCanvas = () => dispatch({ type: 'CLEAR_CANVAS' });

  const handleRandomCombo = () => {
    const randomPanda = PANDA_HEADS[Math.floor(Math.random() * PANDA_HEADS.length)];
    const randomFace = FACES[Math.floor(Math.random() * FACES.length)];
    const texts = state.language === 'zh' ? ZH_TEXTS : EN_TEXTS;
    const randomText = texts[Math.floor(Math.random() * texts.length)];
    const offset = randomPanda.faceOffset;
    const pandaEl: ImageElement = { id: generateId(), type: 'image', src: randomPanda.src, name: randomPanda.id, x: 75, y: 50, width: 350, height: 350, rotation: 0, opacity: 1, zIndex: 0, flipX: false };
    const faceEl: ImageElement = { id: generateId(), type: 'image', src: randomFace.src, name: randomFace.id, x: offset.x, y: offset.y, width: offset.w, height: offset.h, rotation: 0, opacity: 1, zIndex: 1, flipX: false };
    const textEl: TextElement = { id: generateId(), type: 'text', text: randomText, x: 50, y: 440, width: 400, height: 50, rotation: 0, opacity: 1, zIndex: 10, fontFamily: '"Noto Sans SC", "Impact", sans-serif', fontSize: 36, fontWeight: 'bold', textAlign: 'center', fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 3 };
    dispatch({ type: 'CLEAR_CANVAS' });
    dispatch({ type: 'ADD_ELEMENT', element: pandaEl });
    dispatch({ type: 'ADD_ELEMENT', element: faceEl });
    dispatch({ type: 'ADD_ELEMENT', element: textEl });
    if (isMobile) setSheetOpen(false);
  };

  const handleSwitchImage = () => {
    const currentPanda = state.elements.find(isPanda) as ImageElement | undefined;
    const currentFace = state.elements.find(isFace) as ImageElement | undefined;
    if (currentPanda) {
      const otherPandas = PANDA_HEADS.filter(p => p.id !== currentPanda.name);
      if (otherPandas.length > 0) {
        const newPanda = otherPandas[Math.floor(Math.random() * otherPandas.length)];
        dispatch({ type: 'UPDATE_ELEMENT', id: currentPanda.id, updates: { src: newPanda.src, name: newPanda.id } });
      }
    }
    if (currentFace) {
      const otherFaces = FACES.filter(f => f.id !== currentFace.name);
      if (otherFaces.length > 0) {
        const newFace = otherFaces[Math.floor(Math.random() * otherFaces.length)];
        dispatch({ type: 'UPDATE_ELEMENT', id: currentFace.id, updates: { src: newFace.src, name: newFace.id } });
      }
    }
    if (!currentPanda && !currentFace) { handleRandomCombo(); return; }
    if (currentPanda && !currentFace) {
      const offset = getPandaFaceOffset(currentPanda.name);
      const newFace = FACES[Math.floor(Math.random() * FACES.length)];
      const faceEl: ImageElement = { id: generateId(), type: 'image', src: newFace.src, name: newFace.id, x: offset.x, y: offset.y, width: offset.w, height: offset.h, rotation: 0, opacity: 1, zIndex: 1, flipX: false };
      dispatch({ type: 'ADD_ELEMENT', element: faceEl });
    }
  };

  const handleRecommendText = () => {
    const texts = state.language === 'zh' ? ZH_TEXTS : EN_TEXTS;
    const randomText = texts[Math.floor(Math.random() * texts.length)];
    const existingText = state.elements.find(e => e.type === 'text');
    if (existingText) {
      dispatch({ type: 'UPDATE_ELEMENT', id: existingText.id, updates: { text: randomText } });
    } else {
      const textEl: TextElement = { id: generateId(), type: 'text', text: randomText, x: 50, y: 440, width: 400, height: 50, rotation: 0, opacity: 1, zIndex: 10, fontFamily: '"Noto Sans SC", "Impact", sans-serif', fontSize: 36, fontWeight: 'bold', textAlign: 'center', fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 3 };
      dispatch({ type: 'ADD_ELEMENT', element: textEl });
    }
  };

  const handleAddText = () => {
    const promptText = state.language === 'zh' ? '输入文字内容' : 'Enter text content';
    const defaultText = state.language === 'zh' ? '点击输入文字' : 'Click to enter text';
    const text = window.prompt(promptText, defaultText);
    if (!text || text.trim() === '') return;
    const textEl: TextElement = { id: generateId(), type: 'text', text: text.trim(), x: 50, y: 440, width: 400, height: 50, rotation: 0, opacity: 1, zIndex: 10, fontFamily: '"Noto Sans SC", "Impact", sans-serif', fontSize: 36, fontWeight: 'bold', textAlign: 'center', fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 3 };
    dispatch({ type: 'ADD_ELEMENT', element: textEl });
    dispatch({ type: 'SELECT_ELEMENT', id: textEl.id });
  };

  const handleShare = async (platform: 'x' | 'facebook') => {
    if (platform === 'x') {
      // Copy canvas image then open X intent
      if (!canvasRef.current || state.elements.length === 0) {
        alert(state.language === 'zh' ? '画布为空' : 'Canvas is empty');
        return;
      }
      try {
        const prevSelected = state.selectedId;
        dispatch({ type: 'SELECT_ELEMENT', id: null });
        await new Promise(r => setTimeout(r, 300));
        const canvas = await html2canvas(canvasRef.current, {
          backgroundColor: '#FFFFFF', scale: 2, useCORS: true, allowTaint: true,
          logging: false, foreignObjectRendering: false, imageTimeout: 5000,
        });
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (blob) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          setCopyToast(t('copyImageSuccess'));
        } else {
          setCopyToast(t('copyImageFailed'));
        }
        setTimeout(() => setCopyToast(null), 3000);
        if (prevSelected) dispatch({ type: 'SELECT_ELEMENT', id: prevSelected });
      } catch (err) {
        console.error('Copy canvas failed:', err);
        setCopyToast(t('copyImageFailed'));
        setTimeout(() => setCopyToast(null), 3000);
      }
      const text = encodeURIComponent((state.language === 'zh' ? '来看看我制作的熊猫头表情包！🐼' : 'Check out my panda meme! 🐼') + '\n\n');
      window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(window.location.href)}`, '_blank', 'noopener,noreferrer,width=600,height=400');
    } else {
      const text = state.language === 'zh' ? '来看看我制作的熊猫头表情包！' : 'Check out my panda meme!';
      const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}&quote=${encodeURIComponent(text)}`;
      window.open(url, '_blank', 'noopener,noreferrer,width=600,height=400');
    }
  };

  const handleUploadPanda = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string; if (!dataUrl) return;
      const img = new window.Image();
      img.onload = () => {
        state.elements.filter(isPanda).forEach(el => dispatch({ type: 'REMOVE_ELEMENT', id: el.id }));
        const element: ImageElement = { id: generateId(), type: 'image', src: dataUrl, name: `upload-panda-${Date.now()}`, x: 75, y: 50, width: 350, height: 350, rotation: 0, opacity: 1, zIndex: 0, flipX: false };
        dispatch({ type: 'ADD_ELEMENT', element });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file); e.target.value = '';
  };

  const handleUploadFace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string; if (!dataUrl) return;
      const img = new window.Image();
      img.onload = () => {
        state.elements.filter(isFace).forEach(el => dispatch({ type: 'REMOVE_ELEMENT', id: el.id }));
        const currentPanda = state.elements.find(isPanda) as ImageElement | undefined;
        if (!currentPanda) {
          dispatch({ type: 'ADD_ELEMENT', element: { id: generateId(), type: 'image', src: './assets/panda-head.png', name: 'panda-head', x: 75, y: 50, width: 350, height: 350, rotation: 0, opacity: 1, zIndex: 0, flipX: false } });
        }
        const pandaId = currentPanda?.name ?? 'panda-head';
        const offset = getPandaFaceOffset(pandaId);
        setTimeout(() => {
          const element: ImageElement = { id: generateId(), type: 'image', src: dataUrl, name: `upload-face-${Date.now()}`, x: offset.x, y: offset.y, width: offset.w, height: offset.h, rotation: 0, opacity: 1, zIndex: 1, flipX: false };
          dispatch({ type: 'ADD_ELEMENT', element });
        }, 10);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file); e.target.value = '';
  };

  const handleCustomFaceConfirm = (dataUrl: string, facePos?: { x: number; y: number; w: number; h: number }) => {
    state.elements.filter(isFace).forEach(el => dispatch({ type: 'REMOVE_ELEMENT', id: el.id }));
    let currentPanda = state.elements.find(isPanda) as ImageElement | undefined;
    if (!currentPanda) {
      const defaultPanda = PANDA_HEADS[0];
      currentPanda = {
        id: generateId(), type: 'image', src: defaultPanda.src, name: defaultPanda.id,
        x: 75, y: 50, width: 350, height: 350, rotation: 0, opacity: 1, zIndex: 0, flipX: false,
      };
      dispatch({ type: 'ADD_ELEMENT', element: currentPanda });
    }
    const offset = facePos || getPandaFaceOffset(currentPanda.name);
    setTimeout(() => {
      const element: ImageElement = {
        id: generateId(), type: 'image', src: dataUrl, name: `custom-face-${Date.now()}`,
        x: offset.x, y: offset.y, width: offset.w, height: offset.h,
        rotation: 0, opacity: 1, zIndex: 1, flipX: false,
      };
      dispatch({ type: 'ADD_ELEMENT', element });
    }, 10);
    setModalOpen(false);
    if (isMobile) setSheetOpen(false);
  };

  const handleRefreshPreview = useCallback(async () => {
    if (!canvasRef.current) return;
    const prevSelected = state.selectedId;
    dispatch({ type: 'SELECT_ELEMENT', id: null });
    await new Promise(r => setTimeout(r, 150));
    try {
      const canvas = await html2canvas(canvasRef.current, { backgroundColor: '#FFFFFF', scale: 1, useCORS: true, allowTaint: true, removeContainer: true, logging: false });
      setPreviewUrl(canvas.toDataURL('image/png'));
    } catch (err) { console.error('Preview failed:', err); }
    if (prevSelected) dispatch({ type: 'SELECT_ELEMENT', id: prevSelected });
  }, [canvasRef, state.selectedId, dispatch]);

  const selectedElement = state.selectedId ? state.elements.find(e => e.id === state.selectedId) : undefined;

  // ===== MOBILE: Bottom Sheet =====
  if (isMobile) {
    const sheetTitle = state.language === 'zh' ? '工具面板' : 'Tools';
    return (
      <>
        {/* FAB */}
        <button className="mobile-fab-right" onClick={() => setSheetOpen(true)} title={sheetTitle}>
          <ChevronUp size={24} />
        </button>

        {/* Overlay */}
        <div className={`bottom-sheet-overlay ${sheetOpen ? 'open' : ''}`} onClick={() => setSheetOpen(false)} />

        {/* Sheet */}
        <div className={`bottom-sheet ${sheetOpen ? 'open' : ''}`} style={{ maxHeight: '70vh' }}>
          <div className="bottom-sheet-header">
            <span className="bottom-sheet-title">{sheetTitle}</span>
            <button className="bottom-sheet-close" onClick={() => setSheetOpen(false)}><X size={18} /></button>
          </div>
          <div className="bottom-sheet-body">
            {/* Preview */}
            <div className="mb-4">
              <div
                className="rounded-lg overflow-hidden flex items-center justify-center cursor-pointer"
                style={{ backgroundColor: '#FFFFFF', border: '1px solid #ddd', aspectRatio: '1' }}
                onClick={handleRefreshPreview}
              >
                {previewUrl ? (
                  <img src={previewUrl} alt="preview" className="w-full h-full object-contain" style={{ backgroundColor: '#FFFFFF' }} />
                ) : (
                  <div className="flex flex-col items-center gap-1 py-6">
                    <Image size={24} color="#999" />
                    <span className="text-[10px]" style={{ color: '#888' }}>{state.language === 'zh' ? '点击生成预览' : 'Click for preview'}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Transform (if image selected) */}
            {state.selectedId && state.elements.find(e => e.id === state.selectedId)?.type === 'image' && (
              <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    onClick={() => { const el = state.elements.find(e => e.id === state.selectedId) as ImageElement | undefined; if (el) dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { flipX: !el.flipX } }); }}
                    className="py-2.5 rounded-lg text-xs font-medium text-white"
                    style={{ backgroundColor: '#2a2a2a' }}
                  >{state.language === 'zh' ? '左右翻转' : 'Flip'}</button>
                  <button
                    onClick={() => { const el = state.elements.find(e => e.id === state.selectedId) as ImageElement | undefined; if (el) dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { rotation: (el.rotation + 90) % 360 } }); }}
                    className="py-2.5 rounded-lg text-xs font-medium text-white"
                    style={{ backgroundColor: '#2a2a2a' }}
                  >{state.language === 'zh' ? '旋转90°' : 'Rotate 90°'}</button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px]" style={{ color: '#888' }}>{state.language === 'zh' ? '旋转' : 'Rotate'}</span>
                  <input type="range" min={-180} max={180} step={1}
                    value={(state.elements.find(e => e.id === state.selectedId) as ImageElement | undefined)?.rotation ?? 0}
                    onChange={e => { const el = state.elements.find(e => e.id === state.selectedId) as ImageElement | undefined; if (el) dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { rotation: Number(e.target.value) } }); }}
                    className="flex-1" style={{ accentColor: '#FF5E00' }} />
                  <span className="text-[10px] font-mono" style={{ color: '#ccc' }}>{(state.elements.find(e => e.id === state.selectedId) as ImageElement | undefined)?.rotation ?? 0}°</span>
                </div>
              </div>
            )}

            {/* Text Edit (if text selected) */}
            {state.selectedId && state.elements.find(e => e.id === state.selectedId)?.type === 'text' && (
              <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={(state.elements.find(e => e.id === state.selectedId) as TextElement).text}
                    onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { text: e.target.value } })}
                    className="w-full px-2 py-1.5 rounded text-xs"
                    style={{ backgroundColor: '#2a2a2a', color: '#fff', border: '1px solid #444' }}
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-[9px]" style={{ color: '#888' }}>{state.language === 'zh' ? '字号' : 'Size'}</span>
                    <input type="range" min={8} max={80} step={1}
                      value={(state.elements.find(e => e.id === state.selectedId) as TextElement).fontSize}
                      onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { fontSize: Number(e.target.value) } })}
                      className="flex-1" style={{ accentColor: '#FF5E00' }} />
                    <span className="text-[9px] font-mono" style={{ color: '#ccc' }}>{(state.elements.find(e => e.id === state.selectedId) as TextElement).fontSize}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="color" value={(state.elements.find(e => e.id === state.selectedId) as TextElement).fillColor}
                      onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { fillColor: e.target.value } })}
                      className="w-6 h-6 rounded cursor-pointer"
                      style={{ padding: 0, border: 'none', background: 'none' }} />
                    <input type="color" value={(state.elements.find(e => e.id === state.selectedId) as TextElement).strokeColor}
                      onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { strokeColor: e.target.value } })}
                      className="w-6 h-6 rounded cursor-pointer"
                      style={{ padding: 0, border: 'none', background: 'none' }} />
                    <span className="text-[9px]" style={{ color: '#888' }}>{state.language === 'zh' ? '描边' : 'Stroke'}</span>
                    <input type="range" min={0} max={8} step={0.5}
                      value={(state.elements.find(e => e.id === state.selectedId) as TextElement).strokeWidth}
                      onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { strokeWidth: Number(e.target.value) } })}
                      className="flex-1" style={{ accentColor: '#FF5E00' }} />
                    <span className="text-[9px] font-mono" style={{ color: '#ccc' }}>{(state.elements.find(e => e.id === state.selectedId) as TextElement).strokeWidth}</span>
                  </div>
                  <div className="flex gap-1">
                    {(['left', 'center', 'right'] as const).map(align => (
                      <button key={align}
                        onClick={() => dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { textAlign: align } })}
                        className="flex-1 py-1.5 rounded text-[10px] font-medium"
                        style={{
                          backgroundColor: (state.elements.find(e => e.id === state.selectedId) as TextElement).textAlign === align ? '#FF5E00' : '#2a2a2a',
                          color: '#fff',
                        }}>
                        {align === 'left' && '左'}
                        {align === 'center' && '中'}
                        {align === 'right' && '右'}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        const el = state.elements.find(e => e.id === state.selectedId) as TextElement;
                        dispatch({ type: 'UPDATE_ELEMENT', id: state.selectedId!, updates: { fontWeight: el.fontWeight === 'bold' ? 'normal' : 'bold' } });
                      }}
                      className="flex-1 py-1.5 rounded text-[10px] font-medium"
                      style={{
                        backgroundColor: (state.elements.find(e => e.id === state.selectedId) as TextElement).fontWeight === 'bold' ? '#FF5E00' : '#2a2a2a',
                        color: '#fff',
                      }}
                    >
                      粗
                    </button>
                  </div>
                  <button
                    onClick={() => dispatch({ type: 'REMOVE_ELEMENT', id: state.selectedId! })}
                    className="w-full py-1.5 rounded text-[10px] font-semibold text-white"
                    style={{ backgroundColor: '#EF4444' }}
                  >
                    {state.language === 'zh' ? '删除文字' : 'Delete'}
                  </button>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {!state.museumEditMode && (
                <>
                  <button onClick={handleRandomCombo} className="py-3 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#FF5E00' }}>{t('randomCombo')}</button>
                  <button onClick={handleSwitchImage} disabled={state.elements.filter(e => e.type === 'image').length === 0} className="py-3 rounded-lg text-sm font-semibold text-white disabled:opacity-40" style={{ backgroundColor: '#0080FF' }}>{t('switchImage')}</button>
                </>
              )}
              <button onClick={handleRecommendText} className="py-3 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#00CC66' }}>{t('recommendText')}</button>
              <button onClick={handleAddText} className="py-3 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#9333EA' }}>{t('addText')}</button>
              {!state.museumEditMode && (
                <>
                  <label className="py-3 rounded-lg text-sm font-semibold text-white cursor-pointer flex items-center justify-center gap-1" style={{ backgroundColor: '#8B5CF6' }}>
                    <Upload size={14} />{state.language === 'zh' ? '上传熊猫头' : 'Upload Panda'}
                    <input type="file" accept="image/png,image/jpeg,image/jpg,image/gif" onChange={handleUploadPanda} className="hidden" />
                  </label>
                  <label className="py-3 rounded-lg text-sm font-semibold text-white cursor-pointer flex items-center justify-center gap-1" style={{ backgroundColor: '#EC4899' }}>
                    <Upload size={14} />{state.language === 'zh' ? '上传人脸' : 'Upload Face'}
                    <input type="file" accept="image/png,image/jpeg,image/jpg,image/gif" onChange={handleUploadFace} className="hidden" />
                  </label>
                  <button onClick={() => setModalOpen(true)} className="py-3 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1" style={{ backgroundColor: '#F59E0B' }}>
                    <Camera size={14} />{t('customFace')}
                  </button>
                </>
              )}
              <button onClick={handleExport} disabled={isExporting || state.elements.length === 0} className="py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: '#00CC66' }}>
                {isExporting ? '...' : t('download')}
              </button>
            </div>

            {/* Mobile Share - icon only */}
            <div className="flex items-center justify-center gap-4 mb-4">
              <button onClick={() => handleShare('x')} disabled={state.elements.length === 0}
                title={t('shareX')}
                className="share-icon-btn share-x"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </button>
              <button onClick={() => handleShare('facebook')} disabled={state.elements.length === 0}
                title={t('shareFB')}
                className="share-icon-btn share-fb"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </button>
            </div>

            <button onClick={handleClearCanvas} disabled={state.elements.length === 0} className="w-full py-2.5 rounded-lg text-sm font-medium disabled:opacity-30" style={{ backgroundColor: '#1a1a1a', color: '#888', border: '1px solid #2a2a2a' }}>
              {t('clearCanvas')}
            </button>
          </div>
        </div>

        {showSuccess && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium z-[10000]"
            style={{ backgroundColor: '#00CC66', color: '#fff', animation: 'toastIn 0.3s ease' }}>
            {t('downloadSuccess')}
          </div>
        )}
        {copyToast && (
          <div className="fixed bottom-28 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium z-[10000]"
            style={{ backgroundColor: '#1a1a1a', color: '#fff', border: '1px solid #333', animation: 'toastIn 0.3s ease' }}>
            {copyToast}
          </div>
        )}
        <PhotoCropModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onConfirm={handleCustomFaceConfirm}
          language={state.language}
        />
      </>
    );
  }

  // ===== DESKTOP: Side Panel =====
  return (
    <aside className="desktop-sidebar-right">
      {/* Preview */}
      <div className="p-4" style={{ borderBottom: '1px solid #2a2a2a' }}>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#fff' }}>
          <Sparkles size={14} color="#FF5E00" />{t('preview')}
        </h3>
        <div className="rounded-lg overflow-hidden flex items-center justify-center cursor-pointer" style={{ backgroundColor: '#FFFFFF', border: '1px solid #ddd', aspectRatio: '1' }} onClick={handleRefreshPreview}>
          {previewUrl ? (
            <img src={previewUrl} alt="preview" className="w-full h-full object-contain" style={{ backgroundColor: '#FFFFFF' }} />
          ) : (
            <div className="flex flex-col items-center gap-1 py-8">
              <Image size={28} color="#999" />
              <span className="text-[10px]" style={{ color: '#888' }}>{state.language === 'zh' ? '点击生成预览' : 'Click for preview'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Transform / Text Edit */}
      {selectedElement?.type === 'image' && (
        <div className="p-4" style={{ borderBottom: '1px solid #2a2a2a' }}>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#fff' }}>
            <Settings2 size={14} color="#FF5E00" />{state.language === 'zh' ? '调整素材' : 'Transform'}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { const el = selectedElement as ImageElement; dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { flipX: !el.flipX } }); }} className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: '#1a1a1a', color: '#ccc', border: '1px solid #2a2a2a' }}>{state.language === 'zh' ? '左右翻转' : 'Flip Horizontal'}</button>
            <button onClick={() => { const el = selectedElement as ImageElement; dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { rotation: (el.rotation + 90) % 360 } }); }} className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: '#1a1a1a', color: '#ccc', border: '1px solid #2a2a2a' }}>{state.language === 'zh' ? '旋转90°' : 'Rotate 90°'}</button>
          </div>
          <div className="mt-2">
            <div className="flex justify-between mb-1">
              <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#888' }}>{state.language === 'zh' ? '旋转角度' : 'Rotation'}</label>
              <span className="text-[10px] font-mono" style={{ color: '#ccc' }}>{(selectedElement as ImageElement).rotation}°</span>
            </div>
            <input type="range" min={-180} max={180} step={1} value={(selectedElement as ImageElement).rotation} onChange={e => { const el = selectedElement as ImageElement; dispatch({ type: 'UPDATE_ELEMENT', id: el.id, updates: { rotation: Number(e.target.value) } }); }} className="w-full" style={{ accentColor: '#FF5E00' }} />
          </div>
        </div>
      )}

      {selectedElement?.type === 'text' && (
        <div className="p-4" style={{ borderBottom: '1px solid #2a2a2a' }}>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#fff' }}>
            <Type size={14} color="#FF5E00" />{state.language === 'zh' ? '编辑文字' : 'Edit Text'}
          </h3>
          <div className="space-y-3">
            {/* Text content */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block" style={{ color: '#888' }}>{state.language === 'zh' ? '文字内容' : 'Content'}</label>
              <input
                type="text"
                value={(selectedElement as TextElement).text}
                onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { text: e.target.value } })}
                className="w-full px-2.5 py-2 rounded-lg text-xs"
                style={{ backgroundColor: '#1a1a1a', color: '#fff', border: '1px solid #333' }}
              />
            </div>
            {/* Font size */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#888' }}>{state.language === 'zh' ? '字号' : 'Size'}</label>
                <span className="text-[10px] font-mono" style={{ color: '#ccc' }}>{(selectedElement as TextElement).fontSize}px</span>
              </div>
              <input type="range" min={8} max={80} step={1} value={(selectedElement as TextElement).fontSize} onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { fontSize: Number(e.target.value) } })} className="w-full" style={{ accentColor: '#FF5E00' }} />
            </div>
            {/* Colors row */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block" style={{ color: '#888' }}>{state.language === 'zh' ? '文字色' : 'Color'}</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={(selectedElement as TextElement).fillColor} onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { fillColor: e.target.value } })} className="w-7 h-7 rounded cursor-pointer" style={{ padding: 0, border: 'none', background: 'none' }} />
                  <span className="text-[10px] font-mono" style={{ color: '#888' }}>{(selectedElement as TextElement).fillColor}</span>
                </div>
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block" style={{ color: '#888' }}>{state.language === 'zh' ? '描边色' : 'Stroke'}</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={(selectedElement as TextElement).strokeColor} onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { strokeColor: e.target.value } })} className="w-7 h-7 rounded cursor-pointer" style={{ padding: 0, border: 'none', background: 'none' }} />
                  <span className="text-[10px] font-mono" style={{ color: '#888' }}>{(selectedElement as TextElement).strokeColor}</span>
                </div>
              </div>
            </div>
            {/* Stroke width */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#888' }}>{state.language === 'zh' ? '描边宽度' : 'Stroke Width'}</label>
                <span className="text-[10px] font-mono" style={{ color: '#ccc' }}>{(selectedElement as TextElement).strokeWidth}px</span>
              </div>
              <input type="range" min={0} max={8} step={0.5} value={(selectedElement as TextElement).strokeWidth} onChange={e => dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { strokeWidth: Number(e.target.value) } })} className="w-full" style={{ accentColor: '#FF5E00' }} />
            </div>
            {/* Align & Bold */}
            <div className="flex gap-2">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { textAlign: align } })}
                  className="flex-1 flex items-center justify-center py-2 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundColor: (selectedElement as TextElement).textAlign === align ? '#FF5E00' : '#1a1a1a',
                    color: (selectedElement as TextElement).textAlign === align ? '#fff' : '#ccc',
                    border: '1px solid #2a2a2a',
                  }}
                >
                  {align === 'left' && <AlignLeft size={14} />}
                  {align === 'center' && <AlignCenter size={14} />}
                  {align === 'right' && <AlignRight size={14} />}
                </button>
              ))}
              <button
                onClick={() => {
                  const el = selectedElement as TextElement;
                  dispatch({ type: 'UPDATE_ELEMENT', id: selectedElement.id, updates: { fontWeight: el.fontWeight === 'bold' ? 'normal' : 'bold' } });
                }}
                className="flex-1 flex items-center justify-center py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  backgroundColor: (selectedElement as TextElement).fontWeight === 'bold' ? '#FF5E00' : '#1a1a1a',
                  color: (selectedElement as TextElement).fontWeight === 'bold' ? '#fff' : '#ccc',
                  border: '1px solid #2a2a2a',
                }}
              >
                <Bold size={14} />
              </button>
            </div>
            {/* Delete */}
            <button
              onClick={() => { dispatch({ type: 'REMOVE_ELEMENT', id: selectedElement.id }); }}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:scale-[1.02]"
              style={{ backgroundColor: '#EF4444' }}
            >
              <Trash2 size={14} />{state.language === 'zh' ? '删除文字' : 'Delete Text'}
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="p-4" style={{ borderBottom: '1px solid #2a2a2a' }}>
        <div className="space-y-2">
          {!state.museumEditMode && (
            <>
              <button onClick={handleRandomCombo} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02]" style={{ backgroundColor: '#FF5E00' }}><Shuffle size={16} />{t('randomCombo')}</button>
              <button onClick={handleSwitchImage} disabled={state.elements.filter(e => e.type === 'image').length === 0} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02] disabled:opacity-40" style={{ backgroundColor: '#0080FF' }}><Image size={16} />{t('switchImage')}</button>
            </>
          )}
          <button onClick={handleRecommendText} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02]" style={{ backgroundColor: '#00CC66' }}><MessageCircle size={16} />{t('recommendText')}</button>
          <button onClick={handleAddText} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02]" style={{ backgroundColor: '#9333EA' }}><Type size={16} />{state.language === 'zh' ? '添加文字' : 'Add Text'}</button>
          {!state.museumEditMode && (
            <>
              <label className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02] cursor-pointer" style={{ backgroundColor: '#8B5CF6' }}><Upload size={16} />{state.language === 'zh' ? '上传熊猫头' : 'Upload Panda'}<input type="file" accept="image/png,image/jpeg,image/jpg,image/gif" onChange={handleUploadPanda} className="hidden" /></label>
              <p className="text-[10px] text-center" style={{ color: '#555' }}>{state.language === 'zh' ? '替换当前熊猫头' : 'Replace current panda'}</p>
              <label className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02] cursor-pointer" style={{ backgroundColor: '#EC4899' }}><Upload size={16} />{state.language === 'zh' ? '上传人脸' : 'Upload Face'}<input type="file" accept="image/png,image/jpeg,image/jpg,image/gif" onChange={handleUploadFace} className="hidden" /></label>
              <p className="text-[10px] text-center" style={{ color: '#555' }}>{state.language === 'zh' ? '替换当前人脸' : 'Replace current face'}</p>
              <button onClick={() => setModalOpen(true)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.02]" style={{ backgroundColor: '#F59E0B' }}><Camera size={16} />{t('customFace')}</button>
              <p className="text-[10px] text-center" style={{ color: '#555' }}>{state.language === 'zh' ? '上传照片自动生成熊猫脸' : 'Upload photo to auto-generate face'}</p>
            </>
          )}
        </div>
      </div>

      {/* Social Share + Footer Actions */}
      <div className="p-4 space-y-2 mt-auto">
        <button onClick={handleClearCanvas} disabled={state.elements.length === 0} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-30" style={{ backgroundColor: '#1a1a1a', color: '#888', border: '1px solid #2a2a2a' }}><Trash2 size={14} />{t('clearCanvas')}</button>
        <button onClick={handleExport} disabled={isExporting || state.elements.length === 0} className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50" style={{ backgroundColor: '#00CC66' }}><Download size={16} />{isExporting ? '...' : t('download')}</button>

        {/* Social Share Buttons - icon only with tooltip */}
        <div className="flex items-center justify-center gap-3 pt-3" style={{ borderTop: '1px solid #2a2a2a' }}>
          <button
            onClick={() => handleShare('x')}
            disabled={state.elements.length === 0}
            title={t('shareX')}
            className="share-icon-btn share-x"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </button>
          <button
            onClick={() => handleShare('facebook')}
            disabled={state.elements.length === 0}
            title={t('shareFB')}
            className="share-icon-btn share-fb"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          </button>
        </div>
      </div>

      {showSuccess && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium z-[10000]"
          style={{ backgroundColor: '#00CC66', color: '#fff', animation: 'toastIn 0.3s ease' }}>
          {t('downloadSuccess')}
        </div>
      )}
      {copyToast && (
        <div className="absolute bottom-32 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium z-[10000]"
          style={{ backgroundColor: '#1a1a1a', color: '#fff', border: '1px solid #333', animation: 'toastIn 0.3s ease' }}>
          {copyToast}
        </div>
      )}
      <PhotoCropModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onConfirm={handleCustomFaceConfirm}
        language={state.language}
      />
    </aside>
  );
}
