import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import { translations, type Lang, type TranslationKey } from './translations';

export interface CanvasElement {
  id: string;
  type: 'image' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
}

export interface ImageElement extends CanvasElement {
  type: 'image';
  src: string;
  name: string;
  flipX: boolean;
  // 'multiply' = mix-blend-mode multiply (跟下面图层组合)
  // panda 是透明抠图时 → panda 在 face 之上 multiply, 黑廓盖人脸
  // panda 是不透明白底时 → face 在 panda 之上 multiply, 白头廓内透出 face
  blendMode?: 'multiply' | 'normal';
}

export interface TextElement extends CanvasElement {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  textAlign: 'left' | 'center' | 'right';
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}

export type MemeElement = ImageElement | TextElement;

export interface AppState {
  elements: MemeElement[];
  selectedId: string | null;
  zoom: number;
  language: Lang;
  eraserMode: boolean;
  museumEditMode: boolean;
}

interface PersistedAppState {
  version: number;
  updatedAt: number;
  state: Pick<AppState, 'elements' | 'selectedId' | 'language'>;
}

export interface DraftSlot {
  id: string;
  name: string;
  updatedAt: number | null;
  previewUrl: string;
  elementCount: number;
  state: Pick<AppState, 'elements' | 'selectedId' | 'language'> | null;
}

export type Action =
  | { type: 'ADD_ELEMENT'; element: MemeElement }
  | { type: 'REMOVE_ELEMENT'; id: string }
  | { type: 'UPDATE_ELEMENT'; id: string; updates: Partial<MemeElement> }
  | { type: 'SELECT_ELEMENT'; id: string | null }
  | { type: 'HYDRATE_STATE'; state: AppState }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'SET_LANGUAGE'; lang: Lang }
  | { type: 'SET_ERASER_MODE'; mode: boolean }
  | { type: 'SET_MUSEUM_EDIT_MODE'; mode: boolean }
  | { type: 'CLEAR_CANVAS' };

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

const initialState: AppState = {
  elements: [],
  selectedId: null,
  zoom: 1,
  language: 'zh',
  eraserMode: false,
  museumEditMode: false,
};

const SESSION_STORAGE_KEY = 'xiongmaotou.editor-state.v1';
const DRAFT_SLOTS_STORAGE_KEY = 'xiongmaotou.editor-drafts.v1';
export const DRAFT_SLOT_MAX = 40;

function isImageElement(element: MemeElement): element is ImageElement {
  return element.type === 'image';
}

function isTextElement(element: MemeElement): element is TextElement {
  return element.type === 'text';
}

function sanitizeElement(element: MemeElement): MemeElement | null {
  if (!element || typeof element !== 'object' || !('type' in element)) return null;

  if (isImageElement(element)) {
    if (typeof element.id !== 'string' || typeof element.src !== 'string' || typeof element.name !== 'string') return null;
    return {
      id: element.id,
      type: 'image',
      src: element.src,
      name: element.name,
      x: Number(element.x) || 0,
      y: Number(element.y) || 0,
      width: Math.max(1, Number(element.width) || 1),
      height: Math.max(1, Number(element.height) || 1),
      rotation: Number(element.rotation) || 0,
      opacity: typeof element.opacity === 'number' ? element.opacity : 1,
      zIndex: Number(element.zIndex) || 0,
      flipX: Boolean(element.flipX),
    };
  }

  if (isTextElement(element)) {
    if (typeof element.id !== 'string' || typeof element.text !== 'string') return null;
    return {
      id: element.id,
      type: 'text',
      text: element.text,
      fontFamily: typeof element.fontFamily === 'string' ? element.fontFamily : '"Noto Sans SC", "Impact", sans-serif',
      fontSize: Math.max(8, Number(element.fontSize) || 36),
      fontWeight: element.fontWeight === 'normal' ? 'normal' : 'bold',
      textAlign: element.textAlign === 'left' || element.textAlign === 'right' ? element.textAlign : 'center',
      fillColor: typeof element.fillColor === 'string' ? element.fillColor : '#000000',
      strokeColor: typeof element.strokeColor === 'string' ? element.strokeColor : '#000000',
      strokeWidth: Math.max(0, Number(element.strokeWidth) || 0),
      x: Number(element.x) || 0,
      y: Number(element.y) || 0,
      width: Math.max(1, Number(element.width) || 1),
      height: Math.max(1, Number(element.height) || 1),
      rotation: Number(element.rotation) || 0,
      opacity: typeof element.opacity === 'number' ? element.opacity : 1,
      zIndex: Number(element.zIndex) || 0,
    };
  }

  return null;
}

function loadInitialState(): AppState {
  if (typeof window === 'undefined') return initialState;

  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return initialState;

    const parsed = JSON.parse(raw) as PersistedAppState;
    if (parsed?.version !== 1 || !parsed.state) return initialState;

    const elements = Array.isArray(parsed.state.elements)
      ? parsed.state.elements.map(sanitizeElement).filter((element): element is MemeElement => element !== null)
      : [];
    const selectedId = typeof parsed.state.selectedId === 'string' && elements.some(element => element.id === parsed.state.selectedId)
      ? parsed.state.selectedId
      : null;
    const language = parsed.state.language === 'en' ? 'en' : 'zh';

    return {
      ...initialState,
      elements,
      selectedId,
      language,
    };
  } catch {
    return initialState;
  }
}

function sanitizeStoredState(input: Pick<AppState, 'elements' | 'selectedId' | 'language'> | null | undefined) {
  if (!input) return null;

  const elements = Array.isArray(input.elements)
    ? input.elements.map(sanitizeElement).filter((element): element is MemeElement => element !== null)
    : [];
  const selectedId = typeof input.selectedId === 'string' && elements.some(element => element.id === input.selectedId)
    ? input.selectedId
    : null;
  const language = input.language === 'en' ? 'en' : 'zh';

  return {
    elements,
    selectedId,
    language,
  } satisfies Pick<AppState, 'elements' | 'selectedId' | 'language'>;
}

function loadDraftSlots(): DraftSlot[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(DRAFT_SLOTS_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as DraftSlot[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .slice(0, DRAFT_SLOT_MAX)
      .map((slot, index): DraftSlot => {
        const safeState = sanitizeStoredState(slot?.state);
        return {
          id: typeof slot?.id === 'string' && slot.id ? slot.id : `draft-${index + 1}`,
          name: typeof slot?.name === 'string' && slot.name ? slot.name : `草稿${index + 1}`,
          updatedAt: typeof slot?.updatedAt === 'number' ? slot.updatedAt : null,
          previewUrl: typeof slot?.previewUrl === 'string' ? slot.previewUrl : '',
          elementCount: safeState?.elements.length ?? 0,
          state: safeState,
        };
      })
      // 兼容旧版 3-slot schema：filter 掉初始化时 state=null 但 updatedAt=null 的占位
      .filter(slot => slot.state !== null);
  } catch {
    return [];
  }
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

async function renderDraftPreview(elements: MemeElement[]): Promise<string> {
  if (typeof window === 'undefined' || elements.length === 0) return '';

  const canvas = document.createElement('canvas');
  canvas.width = 220;
  canvas.height = 220;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = canvas.width / 500;
  ctx.scale(scale, scale);

  const orderedElements = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  for (const element of orderedElements) {
    ctx.save();
    ctx.globalAlpha = element.opacity ?? 1;

    if (element.type === 'image') {
      const image = await loadImage(element.src);
      ctx.translate(element.x + element.width / 2, element.y + element.height / 2);
      ctx.rotate((element.rotation * Math.PI) / 180);
      ctx.scale(element.flipX ? -1 : 1, 1);
      ctx.drawImage(image, -element.width / 2, -element.height / 2, element.width, element.height);
      ctx.restore();
      continue;
    }

    ctx.translate(element.x, element.y);
    ctx.rotate((element.rotation * Math.PI) / 180);
    ctx.font = `${element.fontWeight} ${element.fontSize}px ${element.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = element.textAlign;
    ctx.fillStyle = element.fillColor;
    ctx.strokeStyle = element.strokeColor;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0, element.strokeWidth * 2);

    const textX = element.textAlign === 'center' ? element.width / 2 : element.textAlign === 'right' ? element.width : 0;
    if (element.strokeWidth > 0) {
      ctx.strokeText(element.text, textX, 0);
    }
    ctx.fillText(element.text, textX, 0);
    ctx.restore();
  }

  return canvas.toDataURL('image/jpeg', 0.82);
}

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_ELEMENT': {
      let element = action.element;
      // 默认图层规则: face=1 (底), panda=5 (中, 加 mix-blend-mode multiply), text=100 (顶)
      // 如果 element 自带 zIndex 且 != 0, 尊重它 (跨流程显式指定)
      // 如果 zIndex === 0 (旧调用方未指定), 自动 max+1 放最上 (兼容旧拖拽行为)
      if (!element.zIndex || element.zIndex === 0) {
        const maxZ = state.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
        element = { ...element, zIndex: maxZ + 1 };
      }
      return { ...state, elements: [...state.elements, element], selectedId: element.id };
    }
    case 'REMOVE_ELEMENT':
      return {
        ...state,
        elements: state.elements.filter(e => e.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    case 'UPDATE_ELEMENT':
      return {
        ...state,
        elements: state.elements.map(e =>
          e.id === action.id ? { ...e, ...action.updates } as MemeElement : e
        ),
      };
    case 'SELECT_ELEMENT':
      return { ...state, selectedId: action.id };
    case 'HYDRATE_STATE':
      return { ...action.state, zoom: 1, eraserMode: false, museumEditMode: false };
    case 'SET_ZOOM':
      return { ...state, zoom: Math.max(0.25, Math.min(2, action.zoom)) };
    case 'SET_LANGUAGE':
      return { ...state, language: action.lang };
    case 'SET_ERASER_MODE':
      return { ...state, eraserMode: action.mode, selectedId: action.mode ? state.selectedId : null };
    case 'SET_MUSEUM_EDIT_MODE':
      return { ...state, museumEditMode: action.mode };
    case 'CLEAR_CANVAS':
      return { ...state, elements: [], selectedId: null, eraserMode: false, museumEditMode: false };
    default:
      return state;
  }
}

interface MemeContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  t: (key: TranslationKey) => string;
  generateId: () => string;
  draftSlots: DraftSlot[];
  saveDraft: (slotId: string) => Promise<void>;
  // QuickMode 收藏时调这个 — 传入已构造好的 editor elements 而不是用当前 state
  // 让 QuickMode 的"心"按钮也能产生本地草稿 (打通快速 ↔ 编辑器草稿)
  saveDraftWithState: (
    slotId: string,
    snapshot: Pick<AppState, 'elements' | 'selectedId' | 'language'>,
    name?: string,
  ) => Promise<void>;
  loadDraft: (slotId: string) => void;
  clearDraft: (slotId: string) => void;
  renameDraft: (slotId: string, name: string) => void;
}

const MemeContext = createContext<MemeContextType | null>(null);

export function MemeProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, undefined, loadInitialState);
  const t = useCallback(
    (key: TranslationKey) => translations[state.language][key],
    [state.language]
  );
  const [draftSlots, setDraftSlots] = React.useState<DraftSlot[]>(() => loadDraftSlots());

  const persistDraftSlots = useCallback((nextDraftSlots: DraftSlot[]) => {
    setDraftSlots(nextDraftSlots);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DRAFT_SLOTS_STORAGE_KEY, JSON.stringify(nextDraftSlots));
    }
  }, []);

  const saveDraft = useCallback(async (slotId: string) => {
    const previewUrl = await renderDraftPreview(state.elements);
    const savedState = {
      elements: state.elements,
      selectedId: state.selectedId,
      language: state.language,
    } satisfies Pick<AppState, 'elements' | 'selectedId' | 'language'>;

    const existingIndex = draftSlots.findIndex(slot => slot.id === slotId);
    let nextDraftSlots: DraftSlot[];

    if (existingIndex >= 0) {
      // 覆盖已有 slot
      nextDraftSlots = draftSlots.map(slot => (
        slot.id === slotId
          ? { ...slot, updatedAt: Date.now(), previewUrl, elementCount: state.elements.length, state: savedState }
          : slot
      ));
    } else if (draftSlots.length < DRAFT_SLOT_MAX) {
      // 追加新 slot
      const index = draftSlots.length + 1;
      nextDraftSlots = [
        ...draftSlots,
        {
          id: slotId,
          name: `草稿${index}`,
          updatedAt: Date.now(),
          previewUrl,
          elementCount: state.elements.length,
          state: savedState,
        },
      ];
    } else {
      // 已满 40 — 覆盖最旧的（updatedAt 最小）
      const oldestIndex = draftSlots.reduce((minIdx, slot, idx, arr) => {
        const cur = slot.updatedAt ?? 0;
        const min = arr[minIdx].updatedAt ?? 0;
        return cur < min ? idx : minIdx;
      }, 0);
      nextDraftSlots = draftSlots.map((slot, idx) => (
        idx === oldestIndex
          ? { ...slot, updatedAt: Date.now(), previewUrl, elementCount: state.elements.length, state: savedState }
          : slot
      ));
    }

    persistDraftSlots(nextDraftSlots);
  }, [draftSlots, persistDraftSlots, state.elements, state.language, state.selectedId]);

  const saveDraftWithState = useCallback(async (
    slotId: string,
    snapshot: Pick<AppState, 'elements' | 'selectedId' | 'language'>,
    name?: string,
  ) => {
    const previewUrl = await renderDraftPreview(snapshot.elements);
    const safe = sanitizeStoredState(snapshot);
    if (!safe) return;

    const existingIndex = draftSlots.findIndex(slot => slot.id === slotId);
    let nextDraftSlots: DraftSlot[];

    if (existingIndex >= 0) {
      // 覆盖已有 slot (保留原 name 除非显式传新名)
      nextDraftSlots = draftSlots.map(slot => (
        slot.id === slotId
          ? {
              ...slot,
              name: name || slot.name,
              updatedAt: Date.now(),
              previewUrl,
              elementCount: safe.elements.length,
              state: safe,
            }
          : slot
      ));
    } else if (draftSlots.length < DRAFT_SLOT_MAX) {
      const idx = draftSlots.length + 1;
      nextDraftSlots = [
        ...draftSlots,
        {
          id: slotId,
          name: name || `草稿${idx}`,
          updatedAt: Date.now(),
          previewUrl,
          elementCount: safe.elements.length,
          state: safe,
        },
      ];
    } else {
      // 满 40 — 覆盖最旧的
      const oldestIndex = draftSlots.reduce((minIdx, slot, idx, arr) => {
        const cur = slot.updatedAt ?? 0;
        const min = arr[minIdx].updatedAt ?? 0;
        return cur < min ? idx : minIdx;
      }, 0);
      nextDraftSlots = draftSlots.map((slot, idx) => (
        idx === oldestIndex
          ? { ...slot, name: name || slot.name, updatedAt: Date.now(), previewUrl, elementCount: safe.elements.length, state: safe }
          : slot
      ));
    }

    persistDraftSlots(nextDraftSlots);
  }, [draftSlots, persistDraftSlots]);

  const loadDraft = useCallback((slotId: string) => {
    const slot = draftSlots.find(item => item.id === slotId);
    const restored = sanitizeStoredState(slot?.state);
    if (!restored) return;
    dispatch({
      type: 'HYDRATE_STATE',
      state: {
        ...initialState,
        ...restored,
      },
    });
  }, [draftSlots]);

  const clearDraft = useCallback((slotId: string) => {
    // Dynamic schema：直接移除 slot（不再保留 state=null 的占位）
    const nextDraftSlots = draftSlots.filter(slot => slot.id !== slotId);
    persistDraftSlots(nextDraftSlots);
  }, [draftSlots, persistDraftSlots]);

  const renameDraft = useCallback((slotId: string, name: string) => {
    const trimmed = name.trim();
    // eslint-disable-next-line no-console
    console.log('[renameDraft] called', { slotId, name: trimmed });
    if (!trimmed) return;
    setDraftSlots((prev) => {
      const matchedSlot = prev.find(s => s.id === slotId);
      // eslint-disable-next-line no-console
      console.log('[renameDraft] inside setDraftSlots', {
        slotId,
        foundInPrev: !!matchedSlot,
        oldName: matchedSlot?.name,
        newName: trimmed,
        prevLen: prev.length,
      });
      if (!matchedSlot) return prev;
      if (matchedSlot.name === trimmed) return prev; // 同名跳过
      const next = prev.map(slot => (
        slot.id === slotId ? { ...slot, name: trimmed } : slot
      ));
      // 同步 localStorage
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(DRAFT_SLOTS_STORAGE_KEY, JSON.stringify(next));
        } catch { /* ignore */ }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const snapshot: PersistedAppState = {
          version: 1,
          updatedAt: Date.now(),
          state: {
            elements: state.elements,
            selectedId: state.selectedId,
            language: state.language,
          },
        };
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));
      } catch (error) {
        console.warn('Failed to persist editor state:', error);
      }
    }, 120);

    return () => window.clearTimeout(timer);
  }, [state.elements, state.selectedId, state.language]);

  return (
    <MemeContext.Provider value={{ state, dispatch, t, generateId, draftSlots, saveDraft, saveDraftWithState, loadDraft, clearDraft, renameDraft }}>
      {children}
    </MemeContext.Provider>
  );
}

export function useMeme() {
  const ctx = useContext(MemeContext);
  if (!ctx) throw new Error('useMeme must be used within MemeProvider');
  return ctx;
}
