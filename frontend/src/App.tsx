import { useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { ImagePage } from './pages/ImagePage';
import { QwenAnglePage } from './pages/QwenAnglePage';
import { VideoPage } from './pages/VideoPage';
import { SettingsPage } from './pages/SettingsPage';
import { ChatPage } from './pages/ChatPage';
import { GalleryPage } from './pages/GalleryPage';
import { VideosPage } from './pages/VideosPage';
import { LibraryPage } from './pages/LibraryPage';
import { LandingPage } from './pages/LandingPage';
import { ToastProvider } from './components/ui/Toast';
import { OllamaQuickPull } from './components/OllamaQuickPull';
import { ComfyExecutionProvider } from './contexts/ComfyExecutionContext';
import { ExecutionStatusBar } from './components/ExecutionStatusBar';
import { MODELS } from './config/api';


function App() {
  const [showLanding, setShowLanding] = useState(true);
  const [activeTab, setActiveTab] = useState('chat');
  const [activeSubTab, setActiveSubTab] = useState<string | null>('z-image');

  const handleTabChange = (tab: string, subTab?: string) => {
    setActiveTab(tab);
    if (subTab) setActiveSubTab(subTab);
  };

  // Find current model info
  const getCurrentModel = () => {
    const allModels = [...MODELS.IMAGE, ...MODELS.VIDEO, ...MODELS.AUDIO];
    return allModels.find((m) => m.id === activeSubTab) || allModels[0];
  };

  const currentModel = getCurrentModel();

  return (
    <ToastProvider>
      <ComfyExecutionProvider>
        <div className="flex h-screen bg-[#0a0a0f] text-white overflow-hidden selection:bg-white/20 font-sans">
          {showLanding && <LandingPage onEnter={() => setShowLanding(false)} />}

          {/* Sidebar */}
          <Sidebar
            activeTab={activeTab}
            activeSubTab={activeSubTab}
            onTabChange={handleTabChange}
          />

          {/* Main Content */}
          <main className="flex-1 flex flex-col overflow-hidden relative bg-[#050508]">
            {/* Background Image Texture */}



            {/* Header */}
            <header className="h-20 border-b border-white/5 flex items-center px-8 z-10 justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                  {['image', 'video', 'audio'].includes(activeTab) ? currentModel.label :
                    activeTab === 'chat' ? 'AI-Assistent' :
                      activeTab === 'gallery' ? 'Gallery' :
                        activeTab === 'videos' ? 'Videos' :
                          activeTab === 'library' ? 'LoRA Library' :
                            activeTab === 'settings' ? 'Settings' :
                              activeTab === 'logs' ? 'Console' : activeTab}
                  {['image', 'video', 'audio'].includes(activeTab) && (
                    <span className="text-sm font-normal text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                      {activeTab}
                    </span>
                  )}
                </h2>
              </div>
              <OllamaQuickPull />
            </header>

            {/* Live Execution Status */}
            <ExecutionStatusBar />

            {/* Content Area — keep-alive pattern preserves state across tab switches */}
            <div className="flex-1 overflow-auto relative z-0">
              {/* Image Pages */}
              <div className="h-full" style={{ display: activeTab === 'image' && currentModel.id === 'qwen-angle' ? undefined : 'none' }}>
                <QwenAnglePage modelId={currentModel.id} modelLabel={currentModel.label} />
              </div>
              <div className="h-full" style={{ display: activeTab === 'image' && currentModel.id !== 'qwen-angle' ? undefined : 'none' }}>
                <ImagePage modelId={currentModel.id} modelLabel={currentModel.label} />
              </div>

              {/* Video Page */}
              <div className="h-full" style={{ display: activeTab === 'video' ? undefined : 'none' }}>
                <VideoPage modelId={currentModel.id} modelLabel={currentModel.label} />
              </div>

              {/* Chat Page */}
              <div className="h-full" style={{ display: activeTab === 'chat' ? undefined : 'none' }}>
                <ChatPage />
              </div>

              {/* Gallery Page */}
              <div className="h-full" style={{ display: activeTab === 'gallery' ? undefined : 'none' }}>
                <GalleryPage />
              </div>

              {/* Videos Page */}
              <div className="h-full" style={{ display: activeTab === 'videos' ? undefined : 'none' }}>
                <VideosPage />
              </div>

              {/* Library Page */}
              <div className="h-full" style={{ display: activeTab === 'library' ? undefined : 'none' }}>
                <LibraryPage />
              </div>

              {/* Settings Page */}
              <div className="h-full" style={{ display: activeTab === 'settings' ? undefined : 'none' }}>
                <SettingsPage />
              </div>

              {/* Lightweight pages — conditional render is fine */}
              {activeTab === 'audio' && (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center text-slate-500">
                    <p className="text-2xl mb-2">🎵</p>
                    <p>Audio generation coming soon</p>
                  </div>
                </div>
              )}

              {activeTab === 'logs' && (
                <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 h-full overflow-auto font-mono text-xs">
                  <div className="text-slate-500">
                    <p>[INFO] ComfyFront initialize</p>
                    <p>[INFO] Connecting to ComfyUI backend...</p>
                    <p className="text-emerald-400">[SUCCESS] Connected to 127.0.0.1:8199</p>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </ComfyExecutionProvider>
    </ToastProvider>
  );
}

export default App;
