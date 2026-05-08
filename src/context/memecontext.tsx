import React, { createContext, useContext, useReducer, useCallback } from 'react';
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

export type Action =
  | { type: 'ADD_ELEMENT'; element: MemeElement }
  | { type: 'REMOVE_ELEMENT'; id: string }
  | { type: 'UPDATE_ELEMENT'; id: string; updates: Partial<MemeElement> }
  | { type: 'SELECT_ELEMENT'; id: string | null }
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

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_ELEMENT': {
      const maxZ = state.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
      const element = { ...action.element, zIndex: maxZ + 1 };
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
}

const MemeContext = createContext<MemeContextType | null>(null);

export function MemeProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const t = useCallback(
    (key: TranslationKey) => translations[state.language][key],
    [state.language]
  );

  return (
    <MemeContext.Provider value={{ state, dispatch, t, generateId }}>
      {children}
    </MemeContext.Provider>
  );
}

export function useMeme() {
  const ctx = useContext(MemeContext);
  if (!ctx) throw new Error('useMeme must be used within MemeProvider');
  return ctx;
}
