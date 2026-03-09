import { useEffect, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { ImagePage } from './pages/ImagePage';
import { QwenAnglePage } from './pages/QwenAnglePage';
import { VideoPage } from './pages/VideoPage';
import { SettingsPage } from './pages/SettingsPage';
import { AudioPage } from './pages/AudioPage';
import { ChatPage } from './pages/ChatPage';
import { GalleryPage } from './pages/GalleryPage';
import { VideosPage } from './pages/VideosPage';
import { LibraryPage } from './pages/LibraryPage';
import { TikTokPage } from './pages/TikTokPage';
import { LandingPage } from './pages/LandingPage';
import { ConsoleLogsPage } from './pages/ConsoleLogsPage';
import { ToastProvider } from './components/ui/Toast';
import { OllamaQuickPull } from './components/OllamaQuickPull';
import { ComfyExecutionProvider } from './contexts/ComfyExecutionContext';
import { ExecutionStatusBar } from './components/ExecutionStatusBar';
import { GlobalAlbumDock } from './components/layout/GlobalAlbumDock';
import { MODELS } from './config/api';

const UI_STATE_KEY = 'fedda_ui_state_v1';
const VALID_TABS = new Set([
  'chat',
  'image',
  'video',
  'audio',
  'logs',
  'gallery',
  'tiktok',
  'videos',
  'library',
  'settings',
]);

const MODEL_TAB_MAP = {
  image: MODELS.IMAGE,
  video: MODELS.VIDEO,
  audio: MODELS.AUDIO,
} as const;

type ModelTab = keyof typeof MODEL_TAB_MAP;

interface UiStateSnapshot {
  showLanding: boolean;
  activeTab: string;
  activeSubTab: string | null;
}

const isModelTab = (tab: string): tab is ModelTab =>
  Object.prototype.hasOwnProperty.call(MODEL_TAB_MAP, tab);

const getDefaultSubTab = (tab: string): string | null => {
  if (!isModelTab(tab)) return null;
  return MODEL_TAB_MAP[tab][0]?.id ?? null;
};

const parseHash = (): { activeTab?: string; activeSubTab?: string | null } => {
  const raw = window.location.hash.replace(/^#/, '').trim();
  if (!raw) return {};

  const [tabToken, subToken] = raw.split('/');
  const decodedTab = decodeURIComponent(tabToken || '');
  if (!VALID_TABS.has(decodedTab)) return {};

  const decodedSub = subToken ? decodeURIComponent(subToken) : null;
  return { activeTab: decodedTab, activeSubTab: decodedSub };
};

const readInitialUiState = (): UiStateSnapshot => {
  let storedTab = 'chat';
  let storedSubTab: string | null = 'z-image';
  let landingDismissed = false;

  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.activeTab === 'string' && VALID_TABS.has(parsed.activeTab)) {
          storedTab = parsed.activeTab;
        }
        if (typeof parsed.activeSubTab === 'string') {
          storedSubTab = parsed.activeSubTab;
        } else if (parsed.activeSubTab === null) {
          storedSubTab = null;
        }
        landingDismissed = parsed.landingDismissed === true;
      }
    }
  } catch {
    // ignore broken storage payloads
  }

  const hashState = parseHash();
  const activeTab = hashState.activeTab || storedTab;
  const hashSub = hashState.activeSubTab;
  const activeSubTab =
    hashSub !== undefined
      ? (hashSub || getDefaultSubTab(activeTab))
      : (storedSubTab || getDefaultSubTab(activeTab));

  const showLanding = !(landingDismissed || Boolean(hashState.activeTab));

  return {
    showLanding,
    activeTab,
    activeSubTab,
  };
};

function App() {
  const [initialState] = useState<UiStateSnapshot>(() => readInitialUiState());
  const [showLanding, setShowLanding] = useState(initialState.showLanding);
  const [activeTab, setActiveTab] = useState(initialState.activeTab);
  const [activeSubTab, setActiveSubTab] = useState<string | null>(initialState.activeSubTab);

  useEffect(() => {
    try {
      localStorage.setItem(
        UI_STATE_KEY,
        JSON.stringify({
          landingDismissed: !showLanding,
          activeTab,
          activeSubTab,
        })
      );
    } catch {
      // ignore localStorage write errors
    }
  }, [showLanding, activeTab, activeSubTab]);

  useEffect(() => {
    if (showLanding) return;
    const hash = activeSubTab
      ? `#${encodeURIComponent(activeTab)}/${encodeURIComponent(activeSubTab)}`
      : `#${encodeURIComponent(activeTab)}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash);
    }
  }, [showLanding, activeTab, activeSubTab]);

  useEffect(() => {
    const handleHashChange = () => {
      const hashState = parseHash();
      if (!hashState.activeTab) return;

      setShowLanding(false);
      setActiveTab(hashState.activeTab);
      if (hashState.activeSubTab !== undefined) {
        setActiveSubTab(hashState.activeSubTab || getDefaultSubTab(hashState.activeTab));
      } else if (isModelTab(hashState.activeTab)) {
        setActiveSubTab(getDefaultSubTab(hashState.activeTab));
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleTabChange = (tab: string, subTab?: string) => {
    setShowLanding(false);
    setActiveTab(tab);
    if (subTab) {
      setActiveSubTab(subTab);
      return;
    }

    if (isModelTab(tab)) {
      setActiveSubTab((prev) => {
        const models = MODEL_TAB_MAP[tab];
        const hasCurrent = models.some((m) => m.id === prev);
        return hasCurrent ? prev : (models[0]?.id || null);
      });
    }
  };

  const handleSendToImg2Img = (_imageUrl: string, _caption?: string) => {
    setShowLanding(false);
    setActiveTab('image');
    setActiveSubTab('z-image');
  };

  const handleSendToInpaint = (_imageUrl: string) => {
    setShowLanding(false);
    setActiveTab('image');
    setActiveSubTab('z-image');
  };

  const handleSendToQwen = (imageUrl: string) => {
    try {
      localStorage.setItem('qwen_input_image_url', imageUrl);
      window.dispatchEvent(new CustomEvent('fedda:qwen-input', { detail: { url: imageUrl } }));
    } catch {
      // ignore storage/event errors
    }

    setShowLanding(false);
    setActiveTab('image');
    setActiveSubTab('qwen-angle');
  };

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

          <Sidebar
            activeTab={activeTab}
            activeSubTab={activeSubTab}
            onTabChange={handleTabChange}
          />

          <main className="flex-1 flex flex-col overflow-hidden relative bg-[#050508]">
            <header className="h-20 border-b border-white/5 flex items-center px-8 z-10 justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                  {['image', 'video', 'audio'].includes(activeTab)
                    ? currentModel.label
                    : activeTab === 'chat'
                      ? 'AI-Assistent'
                      : activeTab === 'gallery'
                        ? 'Gallery'
                        : activeTab === 'videos'
                          ? 'Videos'
                          : activeTab === 'tiktok'
                            ? 'TikTok Studio'
                            : activeTab === 'library'
                              ? 'LoRA Library'
                              : activeTab === 'settings'
                                ? 'Settings'
                                : activeTab === 'logs'
                                  ? 'Console'
                                  : activeTab}
                  {['image', 'video', 'audio'].includes(activeTab) && (
                    <span className="text-sm font-normal text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                      {activeTab}
                    </span>
                  )}
                </h2>
              </div>
              <OllamaQuickPull />
            </header>

            <ExecutionStatusBar />

            <div className="flex-1 flex overflow-hidden relative z-0">
              <div className="flex-1 overflow-auto">
                <div className="h-full" style={{ display: activeTab === 'image' && currentModel.id === 'qwen-angle' ? undefined : 'none' }}>
                  <QwenAnglePage modelId={currentModel.id} modelLabel={currentModel.label} />
                </div>

                <div className="h-full" style={{ display: activeTab === 'image' && currentModel.id !== 'qwen-angle' ? undefined : 'none' }}>
                  <ImagePage modelId={currentModel.id} modelLabel={currentModel.label} />
                </div>

                <div className="h-full" style={{ display: activeTab === 'video' ? undefined : 'none' }}>
                  <VideoPage modelId={currentModel.id} modelLabel={currentModel.label} />
                </div>

                <div className="h-full" style={{ display: activeTab === 'audio' ? undefined : 'none' }}>
                  <AudioPage />
                </div>

                <div className="h-full" style={{ display: activeTab === 'chat' ? undefined : 'none' }}>
                  <ChatPage />
                </div>

                <div className="h-full" style={{ display: activeTab === 'gallery' ? undefined : 'none' }}>
                  <GalleryPage />
                </div>

                <div className="h-full" style={{ display: activeTab === 'videos' ? undefined : 'none' }}>
                  <VideosPage />
                </div>

                <div className="h-full" style={{ display: activeTab === 'tiktok' ? undefined : 'none' }}>
                  <TikTokPage
                    onSendToImg2Img={handleSendToImg2Img}
                    onSendToInpaint={handleSendToInpaint}
                  />
                </div>

                <div className="h-full" style={{ display: activeTab === 'library' ? undefined : 'none' }}>
                  <LibraryPage />
                </div>

                <div className="h-full" style={{ display: activeTab === 'settings' ? undefined : 'none' }}>
                  <SettingsPage />
                </div>

                <div className="h-full" style={{ display: activeTab === 'logs' ? undefined : 'none' }}>
                  <ConsoleLogsPage />
                </div>
              </div>

              {!showLanding && <GlobalAlbumDock onSendToQwen={handleSendToQwen} />}
            </div>
          </main>
        </div>
      </ComfyExecutionProvider>
    </ToastProvider>
  );
}

export default App;
