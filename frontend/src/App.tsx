import { useEffect, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { ImagePage } from './pages/ImagePage';
import { QwenAnglePage } from './pages/QwenAnglePage';
import { Flux2KleinPage } from './pages/Flux2KleinPage';
import { PonyXLPage } from './pages/PonyXLPage';
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
import { ComfyExecutionProvider } from './contexts/ComfyExecutionContext';
import { ExecutionStatusBar } from './components/ExecutionStatusBar';
import { TopSystemStrip } from './components/ui/TopSystemStrip';
import { MODELS } from './config/api';
import { addUiLog, getUiLogs, UI_LOG_EVENT } from './services/uiLogger';
import { HFTokenSettings } from './components/HFTokenSettings';
import { UserPreferencesProvider, useUserPreferences } from './contexts/UserPreferencesContext';
import { NsfwConfirmationModal } from './components/nsfw/NsfwConfirmationModal';
import { NsfwStudioPage } from './components/nsfw/NsfwStudioPage';
import MemoryPanel from './components/MemoryPanel';

const UI_STATE_KEY = 'fedda_ui_state_v1';
const VALID_TABS = new Set([
  'nsfw-studio',
  'chat',
  'image',
  'qwen',
  'flux2klein',
  'ltxhub',
  'ponyxl',
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
  'nsfw-studio': [
    { id: 'nsfw-generate', label: 'BJ VIDEO', icon: 'Flame', category: 'VIDEO' },
    { id: 'nsfw-sdxl', label: 'SDXL IMAGE', icon: 'Sparkles', category: 'IMAGE' },
  ],
  image: MODELS.IMAGE,
  qwen: MODELS.QWEN,
  flux2klein: MODELS.FLUX2KLEIN,
  ltxhub: MODELS.LTXHUB,
  ponyxl: MODELS.PONYXL,
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

const normalizeSubTab = (tab: string, subTab: string | null | undefined): string | null => {
  if (!isModelTab(tab)) return null;
  const defaultSub = getDefaultSubTab(tab);
  if (!subTab) return defaultSub;

  if (tab === 'image') {
    const legacyMap: Record<string, string> = {
      'z-image': 'image-generate',
      generate: 'image-generate',
      hq: 'image-hq',
      img2img: 'image-img2img',
      'mood-edit': 'image-mood-edit',
      inpaint: 'image-inpaint',
      autoinpaint: 'image-autoinpaint',
      metadata: 'image-metadata',
    };
    if (legacyMap[subTab]) return legacyMap[subTab];
  }

  const exists = MODEL_TAB_MAP[tab].some((m) => m.id === subTab);
  return exists ? subTab : defaultSub;
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
  let storedSubTab: string | null = 'image-generate';

  // Read tab/subtab from localStorage (persists across sessions)
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
      ? normalizeSubTab(activeTab, hashSub)
      : normalizeSubTab(activeTab, storedSubTab);

  // Always show landing sequence on startup unless user opened a deep-link hash directly.
  const showLanding = !Boolean(hashState.activeTab);

  return {
    showLanding,
    activeTab,
    activeSubTab,
  };
};

// Gate component to render the modal by consuming the context
const NsfwModalGate = () => {
    const { isConfirmingNsfw, confirmNsfw, cancelNsfw } = useUserPreferences();
    if (!isConfirmingNsfw) return null;
    return <NsfwConfirmationModal onConfirm={confirmNsfw} onCancel={cancelNsfw} />;
};

function FeddaApp() {
  const [initialState] = useState<UiStateSnapshot>(() => readInitialUiState());
  const [showLanding, setShowLanding] = useState(initialState.showLanding);
  const [activeTab, setActiveTab] = useState(initialState.activeTab);
  const [activeSubTab, setActiveSubTab] = useState<string | null>(initialState.activeSubTab);
  const [errorCount, setErrorCount] = useState(0);

  useEffect(() => {
    // Save tab/subtab to localStorage (persists across sessions)
    try {
      localStorage.setItem(
        UI_STATE_KEY,
        JSON.stringify({
          activeTab,
          activeSubTab,
        })
      );
    } catch {
      // ignore localStorage write errors
    }
  }, [activeTab, activeSubTab]);

  useEffect(() => {
    if (showLanding) return;
    const hash = activeSubTab
      ? `#${encodeURIComponent(activeTab)}/${encodeURIComponent(activeSubTab)}`
      : `#${encodeURIComponent(activeTab)}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash);
    }
  }, [showLanding, activeTab, activeSubTab]);

  // Auto-clear activeSubTab when switching to non-model tabs
  useEffect(() => {
    if (!isModelTab(activeTab) && activeSubTab !== null) {
      setActiveSubTab(null);
    }
  }, [activeTab, activeSubTab]);

  // Global keyboard shortcuts: Alt+1-9 for fast tab switching
  useEffect(() => {
    const SHORTCUT_TABS = [
      'chat', 'image', 'video', 'audio', 'ltxhub', 'gallery', 'tiktok', 'library', 'settings'
    ];
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const num = parseInt(e.key);
      if (num >= 1 && num <= SHORTCUT_TABS.length) {
        e.preventDefault();
        const tab = SHORTCUT_TABS[num - 1];
        if (VALID_TABS.has(tab)) {
          setShowLanding(false);
          setActiveTab(tab);
          setActiveSubTab(isModelTab(tab) ? getDefaultSubTab(tab) : null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    addUiLog('info', 'app', 'FEDDA UI initialized');

    // Only log critical errors, not connection failures
    const onError = (event: ErrorEvent) => {
      const msg = event.message || '';
      // Skip network/fetch errors (ComfyUI startup noise)
      if (msg.includes('fetch') || msg.includes('NetworkError') || msg.includes('Failed to')) {
        return;
      }
      // Only log real UI/component errors
      addUiLog('error', 'window', msg, {
        file: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const errorMsg = reason instanceof Error ? reason.message : String(reason);

      // Skip all fetch/connection errors (too noisy during startup)
      if (errorMsg.includes('fetch') ||
          errorMsg.includes('NetworkError') ||
          errorMsg.includes('Failed to') ||
          errorMsg.includes('connection')) {
        return;
      }

      // Only log critical promise rejections
      if (reason instanceof Error) {
        addUiLog('error', 'promise', reason.message, reason.stack || reason.message);
      } else {
        addUiLog('error', 'promise', 'Unhandled promise rejection', reason);
      }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  // Global runtime error handlers

  useEffect(() => {
    const refreshErrorCount = () => {
      const logs = getUiLogs();
      const total = logs.filter((entry) => entry.level === 'error').length;
      setErrorCount(total);
    };

    refreshErrorCount();
    window.addEventListener(UI_LOG_EVENT, refreshErrorCount as EventListener);
    return () => window.removeEventListener(UI_LOG_EVENT, refreshErrorCount as EventListener);
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      const hashState = parseHash();
      if (!hashState.activeTab) return;

      setShowLanding(false);
      setActiveTab(hashState.activeTab);
      if (hashState.activeSubTab !== undefined) {
        setActiveSubTab(normalizeSubTab(hashState.activeTab, hashState.activeSubTab));
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
      setActiveSubTab(normalizeSubTab(tab, subTab));
      return;
    }

    if (isModelTab(tab)) {
      setActiveSubTab((prev) => {
        const models = MODEL_TAB_MAP[tab];
        const hasCurrent = models.some((m) => m.id === prev);
        return hasCurrent ? prev : (models[0]?.id || null);
      });
    } else {
      // Clear subtab for non-model tabs (library, settings, etc.)
      setActiveSubTab(null);
    }
  };

  const handleSendToImg2Img = (_imageUrl: string, _caption?: string) => {
    setShowLanding(false);
    setActiveTab('image');
    setActiveSubTab('image-img2img');
  };

  const handleSendToInpaint = (_imageUrl: string) => {
    setShowLanding(false);
    setActiveTab('image');
    setActiveSubTab('image-inpaint');
  };


  const getCurrentModel = () => {
    const allModels = [...MODELS.IMAGE, ...MODELS.QWEN, ...MODELS.FLUX2KLEIN, ...MODELS.LTXHUB, ...MODELS.VIDEO, ...MODELS.AUDIO];
    return allModels.find((m) => m.id === activeSubTab) || allModels[0];
  };

  const currentModel = getCurrentModel();
  const isLtxHubExperimental = activeTab === 'ltxhub';
  const resolvedVideoModelId = (() => {
    if (activeTab !== 'ltxhub') return currentModel.id;
    return (currentModel as any)?.mapsTo || 'ltx-i2v';
  })();

  return (
    <ToastProvider>
      <ComfyExecutionProvider>
        <NsfwModalGate />
        <div className="flex h-screen theme-bg-app text-white overflow-hidden selection:bg-white/20 font-sans">
          {showLanding && <LandingPage onEnter={() => setShowLanding(false)} />}

          <Sidebar
            activeTab={activeTab}
            activeSubTab={activeSubTab}
            onTabChange={handleTabChange}
          />

          <main className="flex-1 flex flex-col overflow-hidden relative theme-bg-main">
            {activeTab === 'memory' && <MemoryPanel />}

            <header className="h-20 border-b border-white/5 flex items-center px-8 z-10 justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                  {['image', 'qwen', 'flux2klein', 'ltxhub', 'video', 'audio'].includes(activeTab)
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
                  {['image', 'qwen', 'flux2klein', 'ltxhub', 'ponyxl', 'video', 'audio'].includes(activeTab) && (
                    <span className="text-sm font-normal text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                      {activeTab}
                    </span>
                  )}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <TopSystemStrip />
                {isLtxHubExperimental && (
                  <span className="px-2.5 py-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 text-[11px] font-semibold text-sky-200">
                    LTX Hub: Experimental
                  </span>
                )}
                <HFTokenSettings />
                <button
                  onClick={() => {
                    setShowLanding(false);
                    setActiveTab('logs');
                  }}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                    errorCount > 0
                      ? 'border-red-500/50 bg-red-500/15 text-red-200 hover:bg-red-500/25'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                  title="Open Console Logs"
                >
                  {errorCount > 0 ? `Errors: ${errorCount}` : 'No Errors'}
                </button>
              </div>
            </header>

            <ExecutionStatusBar />

            <div className="flex-1 flex overflow-hidden relative z-0">
              <div className="flex-1 overflow-auto">
                <div className="h-full" style={{ display: activeTab === 'nsfw-studio' ? undefined : 'none' }}>
                  <NsfwStudioPage modelId={activeSubTab ?? undefined} />
                </div>

                <div className="h-full" style={{ display: activeTab === 'qwen' ? undefined : 'none' }}>
                  <QwenAnglePage modelId={currentModel.id} modelLabel={currentModel.label} />
                </div>

                <div className="h-full" style={{ display: activeTab === 'image' ? undefined : 'none' }}>
                  <ImagePage modelId={currentModel.id} modelLabel={currentModel.label} />
                </div>

                <div className="h-full" style={{ display: activeTab === 'flux2klein' ? undefined : 'none' }}>
                  <Flux2KleinPage modelId={currentModel.id} modelLabel={currentModel.label} />
                </div>

                <div className="h-full" style={{ display: activeTab === 'ponyxl' ? undefined : 'none' }}>
                  <PonyXLPage modelId={currentModel.id} modelLabel={currentModel.label} />
                </div>

                <div className="h-full" style={{ display: activeTab === 'ltxhub' ? undefined : 'none' }}>
                  <VideoPage modelId={resolvedVideoModelId} modelLabel={currentModel.label} />
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
            </div>
          </main>
        </div>
      </ComfyExecutionProvider>
    </ToastProvider>
  );
}

export default function App() {
  return (
    <UserPreferencesProvider>
      <FeddaApp />
    </UserPreferencesProvider>
  );
}