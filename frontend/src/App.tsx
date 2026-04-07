import { useState, useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { LandingPage } from './pages/LandingPage';
import { TopSystemStrip } from './components/ui/TopSystemStrip';
import { ToastProvider } from './components/ui/Toast';
import { ComfyExecutionProvider } from './contexts/ComfyExecutionContext';
import {
  MessageSquare,
  Sparkles,
  Video,
  Music,
  Images,
  Film,
  LayoutDashboard,
  Wand2,
  Terminal,
  Settings,
} from 'lucide-react';

// ─── Tab registry ──────────────────────────────────────────────────────────
const VALID_TABS = new Set([
  'chat', 'image', 'z-image', 'flux', 'qwen', 'image-other',
  'video', 'wan22-vid2vid', 'wan22-img2vid',
  'ltx', 'ltx-flf', 'ltx-img-audio',
  'audio', 'gallery', 'videos', 'library', 'workflows',
  'logs', 'settings',
]);

const PAGE_META: Record<string, { label: string; description: string; Icon: any }> = {
  chat:        { label: 'Agent Chat',    description: 'Your AI assistant and creative collaborator.',         Icon: MessageSquare   },
  image:       { label: 'Image Studio',  description: 'Generate and edit images with advanced AI models.',    Icon: Sparkles        },
  'z-image':   { label: 'Z-Image (Txt2Img)', description: 'Premium text to image generation using z-image workflow.', Icon: Sparkles },
  flux:        { label: 'Flux Studio',   description: 'Flux based operations and tools.', Icon: Sparkles },
  qwen:        { label: 'Qwen Studio',   description: 'Qwen based structural operations.', Icon: Sparkles },
  'image-other': { label: 'Other Workflows', description: 'Uncategorized image processing capabilities.', Icon: Sparkles },
  video:          { label: 'Video Studio',   description: 'Create and animate video sequences with WAN.',        Icon: Video           },
  'wan22-vid2vid': { label: 'WAN 2.2 Vid2Vid', description: 'Extend and transform video with WAN 2.2.',            Icon: Video           },
  'wan22-img2vid': { label: 'WAN 2.2 Img2Vid', description: 'Animate a still image into video with WAN 2.2.',      Icon: Video           },
  'ltx':           { label: 'LTX Video',        description: 'LTX Video 2.3 — cinematic AI video generation.',      Icon: Film            },
  'ltx-flf':       { label: 'LTX — First / Last Frame',    description: 'Generate video between two keyframes with LTX 2.3.',      Icon: Film },
  'ltx-img-audio': { label: 'LTX — Img + Audio Lipsync', description: 'Generate lipsync video from image and audio with LTX 2.3.', Icon: Film },
  audio:       { label: 'Audio / SFX',   description: 'Generate music, voice, and sound effects.',           Icon: Music           },
  gallery:     { label: 'Gallery',       description: 'Browse and manage your generated images.',             Icon: Images          },
  videos:      { label: 'Videos',        description: 'View and manage your generated video files.',          Icon: Film            },
  library:     { label: 'LoRA Library',  description: 'Manage your installed LoRA models.',                  Icon: LayoutDashboard },
  workflows:   { label: 'Workflows',     description: 'Build and run custom ComfyUI generation pipelines.',  Icon: Wand2           },
  logs:        { label: 'Console Logs',  description: 'Monitor backend logs and debug information.',          Icon: Terminal        },
  settings:    { label: 'Settings',      description: 'Configure models, API keys, and system preferences.', Icon: Settings        },
};

// ─── Persistence ───────────────────────────────────────────────────────────
const TAB_KEY = 'fedda_active_tab_v2';

function readActiveTab(): string {
  try {
    const raw = localStorage.getItem(TAB_KEY);
    if (raw && VALID_TABS.has(raw)) return raw;
  } catch {}
  return 'chat';
}

import { ImageStudioPage } from './pages/ImageStudioPage';
import { VideoStudioPage } from './pages/VideoStudioPage';
import { LibraryPage } from './pages/LibraryPage';
import { SettingsPage } from './pages/SettingsPage';

// ─── App ───────────────────────────────────────────────────────────────────
function FeddaApp() {
  // Show landing only on fresh page load (not when deep-linking via hash)
  const [showLanding, setShowLanding] = useState(true);
  const [activeTab, setActiveTab] = useState<string>(readActiveTab);

  // Persist tab selection across sessions
  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, activeTab); } catch {}
  }, [activeTab]);

  const handleTabChange = (tab: string) => {
    if (!VALID_TABS.has(tab)) return;
    setActiveTab(tab);
  };

  const meta = PAGE_META[activeTab] ?? PAGE_META['chat'];

  // Route determining component
  const renderPage = () => {
    switch (activeTab) {
      case 'image':
      case 'z-image':
      case 'flux':
      case 'qwen':
      case 'image-other':
        return <ImageStudioPage activeTab={activeTab} />;
      case 'video':
      case 'wan22-vid2vid':
      case 'wan22-img2vid':
      case 'ltx':
      case 'ltx-flf':
        return <VideoStudioPage activeTab={activeTab} />;
      case 'library':
        return <LibraryPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return (
          <PlaceholderPage
            label={meta.label}
            description={meta.description}
            icon={<meta.Icon className="w-8 h-8" />}
          />
        );
    }
  };

  return (
    <div className="flex h-screen theme-bg-app text-white overflow-hidden font-sans selection:bg-white/20">
      {/* Intro landing screen — fixed overlay until ComfyUI is ready */}
      {showLanding && <LandingPage onEnter={() => setShowLanding(false)} />}

      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />

      <main className="flex-1 flex flex-col overflow-hidden theme-bg-main">
        {/* Top header */}
        <header className="h-14 border-b border-white/5 flex items-center px-6 shrink-0 z-10 justify-between backdrop-blur-sm bg-black/20">
          <div className="flex items-center gap-3">
            <meta.Icon className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-white tracking-tight">{meta.label}</h2>
          </div>

          {/* Right side: system monitor */}
          <TopSystemStrip />
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-hidden">
          {renderPage()}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ComfyExecutionProvider>
      <ToastProvider>
        <FeddaApp />
      </ToastProvider>
    </ComfyExecutionProvider>
  );
}