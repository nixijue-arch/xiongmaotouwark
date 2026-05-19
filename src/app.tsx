import { lazy, Suspense, useRef, useState } from 'react';
import { MemeProvider } from '@/context/memecontext';
import { Header } from '@/sections/header';
import { LeftSidebar } from '@/sections/leftsidebar';
import { RightSidebar } from '@/sections/rightsidebar';
import { CanvasArea } from '@/sections/canvasarea';
import { EditorBottomBar } from '@/components/editorbottombar';
import { EditorMobilePanel } from '@/components/editormobilepanel';
import { Museum } from '@/sections/museum';
import { AboutPanda } from '@/sections/aboutpanda';
import { QuickMode } from '@/sections/quickmode';
import { Collection } from '@/sections/collection';
import { AnimateMode } from '@/sections/animatemode';
import { Toaster } from 'sonner';
import { AppDialogHost } from '@/components/appdialog';
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

export type Page = 'quick' | 'editor' | 'animate' | 'collection' | 'museum' | 'about' | 'calibrate' | 'materials' | 'captions';

function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<Page>(() => {
    if (import.meta.env.DEV) {
      const url = new URLSearchParams(window.location.search);
      const p = url.get('page');
      const allowed: Page[] = ['quick', 'editor', 'animate', 'collection', 'museum', 'about', 'calibrate', 'materials', 'captions'];
      if (p && (allowed as string[]).includes(p)) {
        return p as Page;
      }
    }
    return 'quick';
  });

  // Mobile scroll fix: page='quick'/'collection'/'museum'/'about' 这些"自然滚动"页加 page-scroll
  // class, mobile.css 让 .app-shell 改成 overflow visible + height auto → 走 iOS body-level scroll
  // → URL bar 滚动时自动收起释放视觉空间. 'editor' 等保持 fixed height + inner scroll (canvas 计算依赖)
  const pageScroll =
    page === 'quick' || page === 'collection' || page === 'museum' || page === 'about';

  return (
    <MemeProvider>
      <div
        className={`app-shell h-screen w-screen flex flex-col overflow-hidden ${pageScroll ? 'app-shell-page-scroll' : ''}`}
      >
        <Header page={page} setPage={setPage} />
        {page === 'quick' ? (
          <QuickMode onOpenEditor={() => setPage('editor')} />
        ) : page === 'animate' ? (
          <AnimateMode />
        ) : page === 'collection' ? (
          <Collection onOpenQuick={() => setPage('quick')} onOpenEditor={() => setPage('editor')} />
        ) : page === 'editor' ? (
          <>
            <div className="editor-layout flex-1 flex overflow-hidden main-content">
              <LeftSidebar />
              <CanvasArea canvasRef={canvasRef} />
              <RightSidebar canvasRef={canvasRef} />
            </div>
            <EditorMobilePanel />
            <EditorBottomBar canvasRef={canvasRef} setPage={setPage} />
          </>
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
        <AppDialogHost />
      </div>
    </MemeProvider>
  );
}

export default App;
