import { useRef, useState } from 'react';
import { MemeProvider } from '@/context/memecontext';
import { Header } from '@/sections/header';
import { LeftSidebar } from '@/sections/leftsidebar';
import { RightSidebar } from '@/sections/rightsidebar';
import { CanvasArea } from '@/sections/canvasarea';
import { Museum } from '@/sections/museum';
import { AboutPanda } from '@/sections/aboutpanda';
import './app.css';

function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<'editor' | 'museum' | 'about'>('editor');

  return (
    <MemeProvider>
      <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ backgroundColor: '#0f0f0f' }}>
        <Header page={page} setPage={setPage} />
        {page === 'editor' ? (
          <div className="flex-1 flex overflow-hidden main-content">
            <LeftSidebar />
            <CanvasArea canvasRef={canvasRef} />
            <RightSidebar canvasRef={canvasRef} />
          </div>
        ) : page === 'museum' ? (
          <Museum onBack={() => setPage('editor')} setPage={setPage} />
        ) : (
          <AboutPanda onBack={() => setPage('editor')} />
        )}
      </div>
    </MemeProvider>
  );
}

export default App;
