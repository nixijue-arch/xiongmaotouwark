import { lazy, Suspense, useRef, useState } from 'react';
import { MemeProvider } from '@/context/memecontext';
import { Header } from '@/sections/header';
import { LeftSidebar } from '@/sections/leftsidebar';
import { RightSidebar } from '@/sections/rightsidebar';
import { CanvasArea } from '@/sections/canvasarea';
import { Museum } from '@/sections/museum';
import { AboutPanda } from '@/sections/aboutpanda';
import { QuickMode } from '@/sections/quickmode';
import { Collection } from '@/sections/collection';
import { Toaster } from 'sonner';
import './app.css';
import './sections/mobile.css';

// DEV-only 工具页 — lazy + DEV conditional import 让 prod build 完全 tree-shake
const CalibrateAnchorLazy = import.meta.env.DEV
  ? lazy(() => import('@/sections/calibrateanchor').then((m) => ({ default: m.CalibrateAnchor })))
  : null;
const MaterialManageLazy = import.meta.env.DEV
  ? lazy(() => import('@/sections/materialmanage').then((m) => ({ default: m.MaterialManage })))
  : null;
const CaptionManageLazy = import.meta.env.DEV
  ? lazy(() => import('@/sections/captionmanage').then((m) => ({ default: m.CaptionManage })))
  : null;

export type Page = 'quick' | 'editor' | 'collection' | 'museum' | 'about' | 'calibrate' | 'materials' | 'captions';

function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<Page>(() => {
    if (import.meta.env.DEV) {
      const url = new URLSearchParams(window.location.search);
      const p = url.get('page');
      const allowed: Page[] = ['quick', 'editor', 'collection', 'museum', 'about', 'calibrate', 'materials', 'captions'];
      if (p && (allowed as string[]).includes(p)) {
        return p as Page;
      }
    }
    return 'editor';
  });

  return (
    <MemeProvider>
      <div className="app-shell h-screen w-screen flex flex-col overflow-hidden">
        <Header page={page} setPage={setPage} />
        {page === 'quick' ? (
          <QuickMode onOpenEditor={() => setPage('editor')} />
        ) : page === 'collection' ? (
          <Collection onOpenQuick={() => setPage('quick')} onOpenEditor={() => setPage('editor')} />
        ) : page === 'editor' ? (
          <div className="editor-layout flex-1 flex overflow-hidden main-content">
            <LeftSidebar />
            <CanvasArea canvasRef={canvasRef} />
            <RightSidebar canvasRef={canvasRef} />
          </div>
        ) : page === 'museum' ? (
          <Museum onBack={() => setPage('editor')} setPage={setPage} />
        ) : page === 'calibrate' && CalibrateAnchorLazy ? (
          <Suspense fallback={<div style={{ flex: 1, padding: 32, color: '#888' }}>加载校准工具...</div>}>
            <CalibrateAnchorLazy onBack={() => setPage('editor')} />
          </Suspense>
        ) : page === 'materials' && MaterialManageLazy ? (
          <Suspense fallback={<div style={{ flex: 1, padding: 32, color: '#888' }}>加载素材管理...</div>}>
            <MaterialManageLazy onBack={() => setPage('editor')} />
          </Suspense>
        ) : page === 'captions' && CaptionManageLazy ? (
          <Suspense fallback={<div style={{ flex: 1, padding: 32, color: '#888' }}>加载文案管理...</div>}>
            <CaptionManageLazy onBack={() => setPage('editor')} />
          </Suspense>
        ) : (
          <AboutPanda onBack={() => setPage('editor')} />
        )}
        <Toaster position="top-right" theme="dark" richColors closeButton />
      </div>
    </MemeProvider>
  );
}

export default App;
